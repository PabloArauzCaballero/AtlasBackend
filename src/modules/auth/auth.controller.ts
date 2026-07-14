import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  LoginPinVerifyDto,
  LogoutDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  ProvisionCredentialsDto,
  RefreshDto,
  loginPinVerifySchema,
  loginSchema,
  logoutSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  provisionCredentialsSchema,
  refreshSchema,
} from './auth.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function userAgentFrom(request: RequestWithNetwork): string | null {
  return firstHeader(request.headers['user-agent']);
}

/**
 * ATLAS-AUDIT-002 (cerrado en este patch). Ver `auth.service.ts` para el detalle de negocio.
 * `login`, `refresh` y `logout` son endpoints públicos (`@Public()`) por diseño: son la puerta
 * de entrada antes de tener un access token, y `logout`/`refresh` operan sobre el refresh token
 * en sí mismo, no sobre el access token.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.authService.login({
      tenantId,
      dto: body,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

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
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.authService.requestPasswordReset({
      tenantId,
      actorType: body.actorType,
      identifier: body.identifier,
      ip: request.ip ?? null,
      userAgent: userAgentFrom(request),
    });
  }

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
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
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
   * No es `@Public()`: requiere un access token vigente de un actor con rol `admin` o
   * `platform_admin` (verificado también dentro de `AuthService.provisionCredentials`, en
   * defensa en profundidad — el chequeo de rol no debe vivir solo en el decorador).
   */
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Provisionar credenciales',
    description:
      'Crea la contraseña inicial de un `internal_user` o `platform_user` ya existente (creado por seed/migración, sin credenciales ' +
      'todavía). Requiere un access token vigente con rol `admin` o `platform_admin` — verificado tanto por el guard de roles como, ' +
      'en defensa en profundidad, dentro del propio `AuthService`.',
  })
  @ApiBody({ schema: zodToApiSchema(provisionCredentialsSchema) })
  @ApiResponse({ status: 201, description: 'Credenciales provisionadas correctamente.' })
  @ApiResponse({ status: 401, description: 'La contraseña no cumple el mínimo de seguridad requerido, o el actor indicado no existe.' })
  @ApiResponse({ status: 403, description: 'El actor autenticado no tiene rol admin/platform_admin.' })
  @ApiResponse({ status: 409, description: 'CREDENTIALS_ALREADY_PROVISIONED — el actor ya tiene contraseña configurada.' })
  @Post('provision-credentials')
  @Roles('admin', 'platform_admin')
  @HttpCode(HttpStatus.CREATED)
  provisionCredentials(
    @Body(new ZodValidationPipe(provisionCredentialsSchema)) body: ProvisionCredentialsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.authService.provisionCredentials(body, { role: currentUser.role });
  }
}
