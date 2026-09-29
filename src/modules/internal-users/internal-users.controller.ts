/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requestMeta } from '../../common/utils/http/headers.util.js';
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalPermissions } from './internal-permissions.decorator.js';
import { InternalUserLockService } from './internal-user-lock.service.js';
import { InternalUsersService } from './internal-users.service.js';
import {
  InternalUserParamsDto,
  ListInternalUsersQueryDto,
  ReplaceInternalUserRolesDto,
  UnlockInternalUserDto,
  UpdateInternalUserDto,
  internalUserParamsSchema,
  listInternalUsersQuerySchema,
  replaceInternalUserRolesSchema,
  unlockInternalUserSchema,
  updateInternalUserSchema,
} from './internal-users.schemas.js';

@ApiTags('internal-users')
@ApiBearerAuth('access-token')
@Controller('internal/users')
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
export class InternalUsersController {
  constructor(
    private readonly internalUsersService: InternalUsersService,
    private readonly lockService: InternalUserLockService,
  ) {}

  @ApiOperation({ summary: 'Listar usuarios internos' })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(listInternalUsersQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(listInternalUsersQuerySchema).limit })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Busca, sin distinguir mayúsculas, en correo, nombre, departamento, cargo y código de rol asignado.',
    schema: zodObjectPropertySchemas(listInternalUsersQuerySchema).q,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Estado de la cuenta.',
    schema: zodObjectPropertySchemas(listInternalUsersQuerySchema).status,
  })
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'Código exacto de un rol vivo asignado (p. ej. SUPER_ADMIN).',
    schema: zodObjectPropertySchemas(listInternalUsersQuerySchema).role,
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de usuarios internos.' })
  @Get()
  @InternalPermissions('internal.users.read')
  list(
    @Query(new ZodValidationPipe(listInternalUsersQuerySchema)) query: ListInternalUsersQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.internalUsersService.listUsers(currentUser, query);
  }

  @ApiOperation({ summary: 'Consultar usuario interno' })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiResponse({ status: 200, description: 'Detalle del usuario interno (con roles y estado de bloqueo por intentos fallidos).' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @Get(':internalUserId')
  @InternalPermissions('internal.users.read')
  async get(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.lockService.withLockState(await this.internalUsersService.getUser(currentUser, params.internalUserId));
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

  @ApiOperation({
    summary: 'Desbloquear usuario interno',
    description:
      'Levanta el bloqueo automático por intentos fallidos (locked_until) y pone el contador a cero. Exige motivo y queda ' +
      'auditado como internal_users.unlock. No cambia el estado del usuario ni revoca sesiones.',
  })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiBody({ schema: zodToApiSchema(unlockInternalUserSchema) })
  @ApiResponse({ status: 200, description: 'Cuenta desbloqueada; devuelve el perfil con su estado de bloqueo.' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'INTERNAL_USER_NOT_LOCKED.' })
  @Post(':internalUserId/unlock')
  @InternalPermissions('internal.users.manage')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @Body(new ZodValidationPipe(unlockInternalUserSchema)) body: UnlockInternalUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.lockService.unlock(currentUser, params.internalUserId, body, requestMeta(request));
  }
}
