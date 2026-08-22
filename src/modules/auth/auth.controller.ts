/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, tenantIdFromHeader, userAgentFrom } from '../../common/utils/http/headers.util.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  LoginPinVerifyDto,
  LogoutDto,
  MfaPreferenceDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  ProvisionCredentialsDto,
  RefreshDto,
  loginPinVerifySchema,
  loginSchema,
  logoutSchema,
  mfaPreferenceSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  provisionCredentialsSchema,
  refreshSchema,
} from './auth.schemas.js';

/**
 * Endpoints públicos de autenticación y endpoints administrativos de provisión de credenciales.
 *
 * `login`, `refresh` y `logout` son públicos por diseño: son la puerta de entrada antes de tener
 * access token y operan sobre credenciales/refresh tokens.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 10 intentos de login por minuto por IP — frena fuerza bruta de credenciales sin estorbar uso legítimo.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @ApiOperation({
    summary: 'Login',
    description:
      'Autentica a un `customer`, `internal_user` o `platform_user` y emite un access+refresh token. ' +
      'El identificador de login depende de `actorType`: para `customer` es el mismo teléfono/email usado en onboarding; ' +
      'para `internal_user`/`platform_user` es el email corporativo. Bloquea temporalmente tras ' +
      '`AUTH_MAX_FAILED_LOGIN_ATTEMPTS` intentos fallidos consecutivos (`AUTH_LOCKOUT_MINUTES`).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant al que pertenece el actor (entero positivo como string).' })
  @ApiBody({ schema: zodToApiSchema(loginSchema) })
  @ApiResponse({
    status: 200,
    description:
      'Login exitoso — access token + refresh token. Para super admins (roles admin/platform_admin) con MailSender ' +
      'configurado, responde en cambio `{ pinChallengeRequired, challengeToken, expiresInMinutes }`: completar con POST /auth/login/pin.',
  })
  @ApiResponse({ status: 400, description: 'x-tenant-id ausente o no es un entero positivo válido.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas, o cuenta bloqueada temporalmente por intentos fallidos.' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
    @Req() request: RequestWithNetwork,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return this.authService.login({
      tenantId,
      dto: body,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  // 10 verificaciones de PIN por minuto por IP — el PIN tiene 6 dígitos; sin throttle sería fuerza-bruteable.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @ApiOperation({
    summary: 'Verificar PIN de login',
    description:
      'Segundo paso del login para super admins (roles admin/platform_admin) cuando MailSender está configurado: ' +
      'canjea el `challengeToken` devuelto por `POST /auth/login` más el PIN de 6 dígitos recibido por correo ' +
      'por el par access+refresh token definitivo.',
  })
  @ApiBody({ schema: zodToApiSchema(loginPinVerifySchema) })
  @ApiResponse({ status: 200, description: 'PIN correcto — access token + refresh token.' })
  @ApiResponse({ status: 401, description: 'PIN inválido, expirado, agotó intentos, o el actor ya no está disponible.' })
  @Post('login/pin')
  @HttpCode(HttpStatus.OK)
  verifyLoginPin(@Body(new ZodValidationPipe(loginPinVerifySchema)) body: LoginPinVerifyDto, @Req() request: RequestWithNetwork) {
    return this.authService.verifyLoginPin({
      challengeToken: body.challengeToken,
      pin: body.pin,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  // 5 solicitudes por minuto por IP — cada request dispara un correo real; complementa el cooldown por destino del servicio.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @ApiOperation({
    summary: 'Solicitar cambio de contraseña',
    description:
      'Envía por correo (MailSender) un código de un solo uso para restablecer la contraseña. ' +
      'La respuesta es idéntica exista o no la cuenta, para no permitir enumeración.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant al que pertenece el actor (entero positivo como string).' })
  @ApiBody({ schema: zodToApiSchema(passwordResetRequestSchema) })
  @ApiResponse({ status: 200, description: 'Solicitud registrada (si la cuenta existe, el código fue enviado por correo).' })
  @ApiResponse({ status: 503, description: 'El servicio de correo (MailSender) no está configurado.' })
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestDto,
    @Req() request: RequestWithNetwork,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return this.authService.requestPasswordReset({
      tenantId,
      actorType: body.actorType,
      identifier: body.identifier,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  // 5 confirmaciones por minuto por IP — limita la fuerza bruta del código de 6 dígitos junto al máximo de intentos en DB.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @ApiOperation({
    summary: 'Confirmar cambio de contraseña',
    description:
      'Fija la contraseña nueva usando el código recibido por correo. Al confirmarse, revoca todos los refresh ' +
      'tokens del actor e invalida los access tokens vigentes (tokenVersion).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant al que pertenece el actor (entero positivo como string).' })
  @ApiBody({ schema: zodToApiSchema(passwordResetConfirmSchema) })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada; todas las sesiones previas quedaron revocadas.' })
  @ApiResponse({ status: 401, description: 'Código inválido/expirado o la contraseña nueva no cumple el mínimo de seguridad.' })
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmDto,
    @Req() request: RequestWithNetwork,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    return this.authService.confirmPasswordReset({
      tenantId,
      actorType: body.actorType,
      identifier: body.identifier,
      code: body.code,
      newPassword: body.newPassword,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  // 30 refresh por minuto por IP — más laxo que login (uso legítimo frecuente) pero frena el descubrimiento de tokens por fuerza bruta.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Public()
  @ApiOperation({
    summary: 'Refresh',
    description:
      'Rota un refresh token vigente por un nuevo access+refresh token (rotación en cada uso — el refresh token anterior queda revocado).',
  })
  @ApiBody({ schema: zodToApiSchema(refreshSchema) })
  @ApiResponse({ status: 200, description: 'Rotación exitosa — nuevo access token + refresh token.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, expirado, o el actor asociado ya no está disponible.' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto, @Req() request: RequestWithNetwork) {
    return this.authService.refresh({
      refreshToken: body.refreshToken,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

  @Public()
  @ApiOperation({
    summary: 'Logout',
    description:
      'Revoca un refresh token (o todos los refresh tokens vigentes del mismo actor, si `allDevices=true`). ' +
      'Idempotente: revocar un token ya revocado no falla.',
  })
  @ApiBody({ schema: zodToApiSchema(logoutSchema) })
  @ApiResponse({ status: 200, description: 'Logout procesado (siempre, incluso si el token ya estaba revocado o no existía).' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutDto) {
    return this.authService.logout({ refreshToken: body.refreshToken, allDevices: body.allDevices });
  }

  /**
   * Identidad del actor autenticado (N15).
   *
   * El frontend necesita el `customerId` para llamar a cualquier endpoint `:customerId`, y hasta
   * ahora la única forma de obtenerlo era decodificar el JWT en el cliente: `POST /auth/login`
   * devuelve solo los tokens, y `GET /internal-auth/me` existe únicamente para actores internos.
   * Decodificar el token en el frontend funciona, pero acopla la app al formato interno del claim.
   */
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Identidad del actor autenticado',
    description:
      'Devuelve el tipo de actor, su rol, su tenant y —para un cliente— su `customerId`. Es la forma soportada de que el ' +
      'frontend conozca su propio identificador sin decodificar el access token.',
  })
  @ApiResponse({ status: 200, description: 'Identidad del actor del token.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o revocado.' })
  @Get('me')
  getMe(@CurrentUser() currentUser: AuthenticatedUser) {
    return {
      actorType: currentUser.customerId ? 'customer' : currentUser.internalUserId ? 'internal_user' : 'platform_user',
      role: currentUser.role,
      tenantId: currentUser.tenantId ?? null,
      customerId: currentUser.customerId ?? null,
      internalUserId: currentUser.internalUserId ?? null,
    };
  }

  /**
   * Fase 4.2: MFA opt-in del cliente. Requiere un access token vigente del propio cliente
   * (`customer`); activa/desactiva su segundo factor por correo para futuros logins. No aplica a
   * actores internos (su 2FA es obligatorio, no configurable aquí).
   */
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Activar/desactivar MFA (cliente)',
    description:
      'Un cliente autenticado activa o desactiva su segundo factor (OTP por correo). Con MFA activo, ' +
      'su próximo login responde `{ pinChallengeRequired, challengeToken, expiresInMinutes }` y debe completarse ' +
      'con POST /auth/login/pin. Activar exige que MailSender esté configurado (si no, no habría cómo entregar el OTP).',
  })
  @ApiBody({ schema: zodToApiSchema(mfaPreferenceSchema) })
  @ApiResponse({ status: 200, description: 'Preferencia de MFA actualizada — `{ mfaEnabled }`.' })
  @ApiResponse({ status: 403, description: 'El actor autenticado no es un cliente.' })
  @ApiResponse({ status: 503, description: 'Se intentó activar MFA pero el servicio de correo no está configurado.' })
  @Post('mfa')
  @HttpCode(HttpStatus.OK)
  setMfaPreference(
    @Body(new ZodValidationPipe(mfaPreferenceSchema)) body: MfaPreferenceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (currentUser.role !== 'customer' || !currentUser.customerId) {
      throw new ForbiddenException('Solo un cliente puede configurar su MFA.');
    }
    return this.authService.setCustomerMfaPreference({ actorId: currentUser.customerId, enabled: body.enabled });
  }

  /**
   * No es `@Public()`: requiere un access token vigente de un actor con rol `admin` o
   * `platform_admin` (verificado también dentro de `AuthService.provisionCredentials`, en
   * defensa en profundidad — el chequeo de rol no debe vivir solo en el decorador).
   *
   * ATLAS-SEC-007: se propaga el `tenantId` del token, no solo el rol. `TenantGuard` no puede
   * proteger este endpoint —el actor destino viaja en el CUERPO (`actorId`), no en `x-tenant-id`—,
   * así que la contención por tenant tiene que decidirla el servicio con la identidad real del
   * solicitante. Pasar solo el rol dejaba a un `admin` del tenant A fijar la contraseña inicial de
   * un usuario interno del tenant B y luego entrar como él.
   */
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Provisionar credenciales',
    description:
      'Crea la contraseña inicial de un `internal_user` o `platform_user` ya existente (creado por seed/migración, sin credenciales ' +
      'todavía). Requiere un access token vigente con rol `admin` o `platform_admin` — verificado tanto por el guard de roles como, ' +
      'en defensa en profundidad, dentro del propio `AuthService`. Un `admin` solo puede provisionar actores de SU MISMO tenant; ' +
      'provisionar en otro tenant, o provisionar un `platform_user` (que opera sobre toda la plataforma), exige `platform_admin`.',
  })
  @ApiBody({ schema: zodToApiSchema(provisionCredentialsSchema) })
  @ApiResponse({ status: 201, description: 'Credenciales provisionadas correctamente.' })
  @ApiResponse({ status: 401, description: 'La contraseña no cumple el mínimo de seguridad requerido, o el actor indicado no existe.' })
  @ApiResponse({
    status: 403,
    description: 'El actor autenticado no tiene rol admin/platform_admin, o intenta provisionar fuera de su tenant.',
  })
  @ApiResponse({ status: 409, description: 'CREDENTIALS_ALREADY_PROVISIONED — el actor ya tiene contraseña configurada.' })
  @Post('provision-credentials')
  @Roles('admin', 'platform_admin')
  @HttpCode(HttpStatus.CREATED)
  provisionCredentials(
    @Body(new ZodValidationPipe(provisionCredentialsSchema)) body: ProvisionCredentialsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.authService.provisionCredentials(body, { role: currentUser.role, tenantId: currentUser.tenantId ?? null });
  }
}
