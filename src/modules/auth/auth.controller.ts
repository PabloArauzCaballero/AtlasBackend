import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  LogoutDto,
  ProvisionCredentialsDto,
  RefreshDto,
  loginSchema,
  logoutSchema,
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
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @ApiOperation({
    summary: 'Login',
    description: 'Autentica a un customer, internal_user o platform_user y emite un access+refresh token.',
  })
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
  @ApiOperation({ summary: 'Refresh', description: 'Rota un refresh token vigente por un nuevo access+refresh token.' })
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
  @ApiOperation({ summary: 'Logout', description: 'Revoca un refresh token (o todos los del actor si allDevices=true).' })
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
  @ApiOperation({
    summary: 'Provisionar credenciales',
    description: 'Crea la contraseña inicial de un internal_user o platform_user ya existente. Solo admin/platform_admin.',
  })
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
