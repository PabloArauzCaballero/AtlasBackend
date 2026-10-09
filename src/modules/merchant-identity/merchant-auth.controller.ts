/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada acceso.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { RequestWithNetwork, firstHeader } from '../../common/utils/http/headers.util.js';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ResponseWithCookies,
  buildAuthCookieOptions,
  readCookie,
} from '../../common/utils/http/auth-cookies.util.js';
import { env } from '../../config/env.js';
import { AuthReauthenticationService, REAUTH_TTL_SECONDS } from '../auth/auth-reauthentication.service.js';
import { MerchantAuthService } from './merchant-auth.service.js';
import {
  MerchantLoginDto,
  MerchantLogoutDto,
  MerchantReauthenticateDto,
  MerchantRefreshDto,
  merchantLoginSchema,
  merchantLogoutSchema,
  merchantReauthenticateSchema,
  merchantRefreshSchema,
} from './merchant-identity.schemas.js';
import { MerchantAuthResponse, MerchantSessionResponse } from './merchant-identity.types.js';

/**
 * Canal de autenticación del comercio afiliado (`/merchant/auth/*`).
 *
 * Mismo contrato que el panel interno —tokens en cookies `HttpOnly`, refresh rotativo, logout
 * idempotente—, distinta población. El ERP consume estos endpoints para reemitir su propio token
 * de negocio; el `sub` que viaja aquí es el que el ERP enlaza contra la membresía del comercio.
 */
@ApiTags('merchant-auth')
@ApiBearerAuth('access-token')
@Controller('merchant/auth')
@UseGuards(JwtAuthGuard)
export class MerchantAuthController {
  constructor(
    private readonly merchantAuthService: MerchantAuthService,
    private readonly reauthentication: AuthReauthenticationService,
  ) {}

  private issueSessionCookies(response: ResponseWithCookies, payload: MerchantAuthResponse): MerchantSessionResponse {
    const refreshMaxAgeMs = env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
    response.cookie(ACCESS_TOKEN_COOKIE, payload.accessToken, buildAuthCookieOptions());
    response.cookie(REFRESH_TOKEN_COOKIE, payload.refreshToken, buildAuthCookieOptions(refreshMaxAgeMs));

    const { accessToken: _accessToken, refreshToken: _refreshToken, tokenType: _tokenType, ...session } = payload;
    return { ...session, tokenType: 'Cookie' };
  }

  /** La cookie manda; el body es el fallback para clientes que no son navegador (el ERP lo es). */
  private resolveRefreshToken(request: RequestWithNetwork, fromBody: string | undefined): string {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE) ?? fromBody ?? null;
    if (!refreshToken) {
      throw new UnauthorizedException('Falta el refresh token: no llegó la cookie de sesión ni un token en el body.');
    }
    return refreshToken;
  }

  // 10 intentos por minuto por IP: mismo freno que el login de clientes y el del portal interno.
  // Sin él, sólo aplicaba el límite global de 100/min, que para probar contraseñas no es un freno.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @ApiOperation({
    summary: 'Login del comercio',
    description: 'Autentica al usuario de un comercio afiliado. El alcance sobre cuentas concretas lo resuelve el ERP.',
  })
  @ApiBody({ schema: zodToApiSchema(merchantLoginSchema) })
  @ApiResponse({ status: 200, description: 'Sesión iniciada; los tokens viajan en cookies HttpOnly.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas, identidad no activa o rol no admitido.' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(merchantLoginSchema)) body: MerchantLoginDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const tenantId = parsePositiveId(body.tenantId ?? String(tenantIdHeader ?? ''), 'tenantId');
    const outcome = await this.merchantAuthService.login({
      tenantId,
      email: body.email,
      password: body.password,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
    return this.issueSessionCookies(response, outcome);
  }

  // 30 por minuto: rotar es legítimo y frecuente, pero sigue probando tokens contra un endpoint público.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Public()
  @ApiOperation({ summary: 'Refresh del comercio', description: 'Rota el refresh token de una sesión de comercio.' })
  @ApiBody({ schema: zodToApiSchema(merchantRefreshSchema) })
  @ApiResponse({ status: 200, description: 'Token rotado.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, revocado, o identidad ya no activa.' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(merchantRefreshSchema)) body: MerchantRefreshDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const tokens = await this.merchantAuthService.refresh({
      refreshToken: this.resolveRefreshToken(request, body.refreshToken),
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
    return this.issueSessionCookies(response, tokens);
  }

  @Public()
  @ApiOperation({ summary: 'Logout del comercio' })
  @ApiBody({ schema: zodToApiSchema(merchantLogoutSchema) })
  @ApiResponse({ status: 200, description: 'Sesión cerrada (idempotente).' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(new ZodValidationPipe(merchantLogoutSchema)) body: MerchantLogoutDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const result = await this.merchantAuthService.logout({
      refreshToken: this.resolveRefreshToken(request, body.refreshToken),
      allDevices: body.allDevices,
    });
    response.clearCookie(ACCESS_TOKEN_COOKIE, buildAuthCookieOptions());
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildAuthCookieOptions());
    return result;
  }

  /**
   * Reautenticación antes de una operación sensible (cambiar la cuenta/QR de cobro).
   *
   * El login del comercio no lleva segundo factor obligatorio; esto es lo que impide que una sesión
   * robada baste para desviar sus cobros. La prueba se manda en la cabecera `x-reauth-token`.
   */
  // 5 por minuto por IP, como el cambio de contraseña: además cuenta en el bloqueo del login.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Reautenticación del comercio',
    description:
      'Valida la contraseña del comercio AUTENTICADO y devuelve una prueba de un solo uso, válida ' +
      `${REAUTH_TTL_SECONDS} s y ligada a ese usuario, que se envía en la cabecera \`x-reauth-token\` de la ` +
      'operación sensible (registrar o reemplazar un QR de cobro). Cada contraseña errada cuenta en el bloqueo del login.',
  })
  @ApiBody({ schema: zodToApiSchema(merchantReauthenticateSchema) })
  @ApiResponse({ status: 200, description: '`{ reauthToken, expiresInSeconds, expiresAt }`.' })
  @ApiResponse({ status: 400, description: 'REAUTH_INVALID_PASSWORD: la contraseña no es correcta.' })
  @ApiResponse({ status: 401, description: 'Sin sesión de comercio, o la identidad ya no está activa.' })
  @ApiResponse({ status: 429, description: 'ACCOUNT_LOCKED (con `lockedUntil`) o demasiadas peticiones.' })
  @Post('reauthenticate')
  @HttpCode(HttpStatus.OK)
  reauthenticate(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(merchantReauthenticateSchema)) body: MerchantReauthenticateDto,
    @Req() request: RequestWithNetwork,
  ) {
    if (!currentUser.merchantUserId) {
      throw new UnauthorizedException('Este endpoint es exclusivo de usuarios de comercio.');
    }
    return this.reauthentication.issue({
      actorType: 'merchant_user',
      actorId: currentUser.merchantUserId,
      tenantId: currentUser.tenantId ?? null,
      password: body.password,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
  }

  @ApiOperation({ summary: 'Perfil del comercio autenticado' })
  @ApiResponse({ status: 200, description: 'Identidad vigente, releída de la base.' })
  @ApiResponse({ status: 401, description: 'El token no es de un usuario de comercio.' })
  @Get('me')
  async me(@CurrentUser() currentUser: AuthenticatedUser) {
    if (!currentUser.merchantUserId) {
      throw new UnauthorizedException('Este endpoint es exclusivo de usuarios de comercio.');
    }
    return this.merchantAuthService.getProfile(currentUser.merchantUserId);
  }
}
