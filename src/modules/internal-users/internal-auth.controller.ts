import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
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

  @Public()
  @ApiOperation({ summary: 'Login interno', description: 'Autentica usuarios internos para el panel administrativo ATLAS.' })
  @ApiBody({ schema: zodToApiSchema(internalLoginSchema) })
  @ApiResponse({ status: 200, description: 'Login exitoso, retorna tokens de sesión interna.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas.' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(internalLoginSchema)) body: InternalLoginDto,
    @Req() request: RequestWithNetwork,
  ) {
    const tenantId = parsePositiveId(body.tenantId ?? String(tenantIdHeader ?? ''), 'tenantId');
    return this.internalAuthService.login({
      tenantId,
      email: body.email,
      password: body.password,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
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
  verifyLoginPin(@Body(new ZodValidationPipe(loginPinVerifySchema)) body: LoginPinVerifyDto, @Req() request: RequestWithNetwork) {
    return this.internalAuthService.verifyLoginPin({
      challengeToken: body.challengeToken,
      pin: body.pin,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
  }

  @Public()
  @ApiOperation({ summary: 'Refresh interno', description: 'Rota refresh token de una sesión interna.' })
  @ApiBody({ schema: zodToApiSchema(internalRefreshSchema) })
  @ApiResponse({ status: 200, description: 'Token rotado.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o revocado.' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(internalRefreshSchema)) body: InternalRefreshDto, @Req() request: RequestWithNetwork) {
    return this.internalAuthService.refresh({
      refreshToken: body.refreshToken,
      ip: request.ip ?? null,
      userAgent: firstHeader(request.headers['user-agent']),
    });
  }

  @Public()
  @ApiOperation({ summary: 'Logout interno', description: 'Revoca refresh token de una sesión interna.' })
  @ApiBody({ schema: zodToApiSchema(internalLogoutSchema) })
  @ApiResponse({ status: 200, description: 'Sesión(es) revocada(s).' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(internalLogoutSchema)) body: InternalLogoutDto) {
    return this.internalAuthService.logout({ refreshToken: body.refreshToken, allDevices: body.allDevices });
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
