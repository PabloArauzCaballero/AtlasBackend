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
import { MerchantAuthService } from './merchant-auth.service.js';
import {
  MerchantLoginDto,
  MerchantLogoutDto,
  MerchantRefreshDto,
  merchantLoginSchema,
  merchantLogoutSchema,
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
  constructor(private readonly merchantAuthService: MerchantAuthService) {}

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
