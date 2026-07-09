import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalPermissions } from './internal-permissions.decorator.js';
import { InternalUsersService } from './internal-users.service.js';
import {
  InternalUserParamsDto,
  ReplaceInternalUserRolesDto,
  UpdateInternalUserDto,
  internalUserParamsSchema,
  replaceInternalUserRolesSchema,
  updateInternalUserSchema,
} from './internal-users.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function requestMeta(request: RequestWithNetwork): { ipAddress: string | null; userAgent: string | null } {
  return { ipAddress: request.ip ?? null, userAgent: firstHeader(request.headers['user-agent']) };
}

@ApiTags('internal-users')
@ApiBearerAuth('access-token')
@Controller('internal/users')
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
export class InternalUsersController {
  constructor(private readonly internalUsersService: InternalUsersService) {}

  @ApiOperation({ summary: 'Listar usuarios internos' })
  @ApiResponse({ status: 200, description: 'Lista de usuarios internos.' })
  @Get()
  @InternalPermissions('internal.users.read')
  list(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.internalUsersService.listUsers(currentUser);
  }

  @ApiOperation({ summary: 'Consultar usuario interno' })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiResponse({ status: 200, description: 'Detalle del usuario interno (con roles).' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @Get(':internalUserId')
  @InternalPermissions('internal.users.read')
  get(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.internalUsersService.getUser(currentUser, params.internalUserId);
  }

  @ApiOperation({ summary: 'Editar usuario interno' })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiBody({ schema: zodToApiSchema(updateInternalUserSchema) })
  @ApiResponse({ status: 200, description: 'Usuario interno actualizado.' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @Patch(':internalUserId')
  @InternalPermissions('internal.users.manage')
  update(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @Body(new ZodValidationPipe(updateInternalUserSchema)) body: UpdateInternalUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.internalUsersService.updateUser(currentUser, params.internalUserId, body, requestMeta(request));
  }

  @ApiOperation({ summary: 'Reemplazar roles de usuario interno' })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiBody({ schema: zodToApiSchema(replaceInternalUserRolesSchema) })
  @ApiResponse({ status: 200, description: 'Roles reemplazados.' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @Patch(':internalUserId/roles')
  @InternalPermissions('internal.users.manage', 'internal.roles.manage')
  @HttpCode(HttpStatus.OK)
  replaceRoles(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @Body(new ZodValidationPipe(replaceInternalUserRolesSchema)) body: ReplaceInternalUserRolesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.internalUsersService.replaceRoles(currentUser, params.internalUserId, body, requestMeta(request));
  }
}
