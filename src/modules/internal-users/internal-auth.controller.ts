import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { RequestWithNetwork, firstHeader, requestMeta } from '../../common/utils/http/headers.util.js';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ResponseWithCookies,
  buildAuthCookieOptions,
  readCookie,
} from '../../common/utils/http/auth-cookies.util.js';
import { env } from '../../config/env.js';
import { InternalAuthResponse, InternalSessionResponse } from './internal-users.types.js';
import { isLoginPinChallenge } from '../auth/auth.service.js';
import { LoginPinVerifyDto, loginPinVerifySchema } from '../auth/auth.schemas.js';
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalAuthService } from './internal-auth.service.js';
import { InternalPermissions } from './internal-permissions.decorator.js';
import { InternalUsersService } from './internal-users.service.js';
import {
  CreateInternalUserDto,
  InternalLoginDto,
  InternalLogoutDto,
  InternalRefreshDto,
  createInternalUserSchema,
  internalLoginSchema,
  internalLogoutSchema,
  internalRefreshSchema,
} from './internal-users.schemas.js';

@ApiTags('internal-auth')
@ApiBearerAuth('access-token')
@Controller('internal/auth')
@UseGuards(JwtAuthGuard, TenantGuard, InternalPermissionsGuard)
export class InternalAuthController {
  constructor(
    private readonly internalAuthService: InternalAuthService,
    private readonly internalUsersService: InternalUsersService,
  ) {}

  /**
   * Mueve los tokens del body a cookies `HttpOnly`. Es el punto donde la sesion del panel deja de
   * ser accesible desde JavaScript: la respuesta ya no contiene `accessToken` ni `refreshToken`.
   *
   * La cookie de access es de sesion (sin `maxAge`) a proposito: su vigencia real la marca el `exp`
   * del JWT, que el guard valida en cada request; darle una expiracion propia solo abriria la
   * puerta a que ambas discrepen. La de refresh si persiste, que es lo que permite recuperar la
   * sesion tras cerrar el navegador.
   */
  private issueSessionCookies(response: ResponseWithCookies, payload: InternalAuthResponse): InternalSessionResponse {
    const refreshMaxAgeMs = env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
    response.cookie(ACCESS_TOKEN_COOKIE, payload.accessToken, buildAuthCookieOptions());
    response.cookie(REFRESH_TOKEN_COOKIE, payload.refreshToken, buildAuthCookieOptions(refreshMaxAgeMs));

    const { accessToken: _accessToken, refreshToken: _refreshToken, tokenType: _tokenType, ...session } = payload;
    return { ...session, tokenType: 'Cookie' };
  }

  private clearSessionCookies(response: ResponseWithCookies): void {
    // `clearCookie` solo borra si los atributos coinciden con los de emision (path/domain/sameSite).
    response.clearCookie(ACCESS_TOKEN_COOKIE, buildAuthCookieOptions());
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildAuthCookieOptions());
  }

  /** La cookie manda; el body es el fallback para clientes que no son navegador. */
  private resolveRefreshToken(request: RequestWithNetwork, fromBody: string | undefined): string {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE) ?? fromBody ?? null;
    if (!refreshToken) {
      throw new UnauthorizedException('Falta el refresh token: no llego la cookie de sesion ni un token en el body.');
    }
    return refreshToken;
  }

  @Public()
  @ApiOperation({ summary: 'Login interno', description: 'Autentica usuarios internos para el panel administrativo ATLAS.' })
  @ApiBody({ schema: zodToApiSchema(internalLoginSchema) })
  @ApiResponse({ status: 200, description: 'Login exitoso, retorna tokens de sesión interna.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas.' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(internalLoginSchema)) body: InternalLoginDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const tenantId = parsePositiveId(body.tenantId ?? String(tenantIdHeader ?? ''), 'tenantId');
    const outcome = await this.internalAuthService.login({
      tenantId,
      email: body.email,
      password: body.password,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });

    // El challenge de PIN todavia no tiene tokens que guardar en cookies.
    if (isLoginPinChallenge(outcome)) return outcome;
    return this.issueSessionCookies(response, outcome);
  }

  @Public()
  @ApiOperation({
    summary: 'Verificar PIN de login interno',
    description:
      'Segundo paso del login para super admins: canjea el `challengeToken` devuelto por el login más el PIN ' +
      'recibido por correo por los tokens y el perfil de la sesión interna.',
  })
  @ApiBody({ schema: zodToApiSchema(loginPinVerifySchema) })
  @ApiResponse({ status: 200, description: 'PIN correcto — tokens + perfil interno.' })
  @ApiResponse({ status: 401, description: 'PIN inválido, expirado o con intentos agotados.' })
  @Post('login/pin')
  @HttpCode(HttpStatus.OK)
  async verifyLoginPin(
    @Body(new ZodValidationPipe(loginPinVerifySchema)) body: LoginPinVerifyDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const tokens = await this.internalAuthService.verifyLoginPin({
      challengeToken: body.challengeToken,
      pin: body.pin,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
    return this.issueSessionCookies(response, tokens);
  }

  @Public()
  @ApiOperation({ summary: 'Refresh interno', description: 'Rota refresh token de una sesión interna.' })
  @ApiBody({ schema: zodToApiSchema(internalRefreshSchema) })
  @ApiResponse({ status: 200, description: 'Token rotado.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o revocado.' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(internalRefreshSchema)) body: InternalRefreshDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const tokens = await this.internalAuthService.refresh({
      refreshToken: this.resolveRefreshToken(request, body.refreshToken),
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
    // El refresh rota el token: las cookies se reemplazan con los valores nuevos.
    return this.issueSessionCookies(response, tokens);
  }

  @Public()
  @ApiOperation({ summary: 'Logout interno', description: 'Revoca refresh token de una sesión interna.' })
  @ApiBody({ schema: zodToApiSchema(internalLogoutSchema) })
  @ApiResponse({ status: 200, description: 'Sesión(es) revocada(s).' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(new ZodValidationPipe(internalLogoutSchema)) body: InternalLogoutDto,
    @Req() request: RequestWithNetwork,
    @Res({ passthrough: true }) response: ResponseWithCookies,
  ) {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE) ?? body.refreshToken ?? null;

    // Las cookies se limpian SIEMPRE, incluso si no hay token que revocar: si no, una cookie ya
    // invalida seguiria en el navegador y el portal creeria que hay sesion.
    this.clearSessionCookies(response);
    if (!refreshToken) return { loggedOut: true };

    return this.internalAuthService.logout({ refreshToken, allDevices: body.allDevices });
  }

  @ApiOperation({
    summary: 'Perfil interno actual',
    description: 'Devuelve usuario, roles y permisos efectivos para renderizar menú dinámico.',
  })
  @ApiResponse({ status: 200, description: 'Perfil, roles y permisos efectivos del usuario interno actual.' })
  @Get('me')
  @InternalPermissions('auth.internal.me.read')
  me(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.internalUsersService.getMyProfile(currentUser);
  }

  @ApiOperation({
    summary: 'Crear usuario interno',
    description: 'Signup interno controlado para el panel admin; no es autorregistro público.',
  })
  @ApiBody({ schema: zodToApiSchema(createInternalUserSchema) })
  @ApiResponse({ status: 201, description: 'Usuario interno creado.' })
  @Post('signup')
  @InternalPermissions('internal.users.manage', 'internal.roles.manage')
  @HttpCode(HttpStatus.CREATED)
  signup(
    @Body(new ZodValidationPipe(createInternalUserSchema)) body: CreateInternalUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.internalUsersService.createUser(currentUser, body, requestMeta(request));
  }
}
