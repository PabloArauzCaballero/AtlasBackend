import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalAccessCatalogService } from './internal-access-catalog.service.js';
import { InternalRoleParamsDto, internalRoleParamsSchema } from './internal-access-catalog.schemas.js';
import { InternalPermissions } from './internal-permissions.decorator.js';

@ApiTags('internal-access-catalog')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
export class InternalAccessCatalogController {
  constructor(private readonly accessCatalogService: InternalAccessCatalogService) {}

  @ApiOperation({ summary: 'Listar roles internos' })
  @ApiResponse({ status: 200, description: 'Lista de roles internos.' })
  @Get('internal/roles')
  @InternalPermissions('internal.roles.read')
  listRoles(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.accessCatalogService.listRoles(currentUser);
  }

  @ApiOperation({ summary: 'Consultar rol interno' })
  @ApiParam({ name: 'roleId', schema: zodToApiSchema(internalRoleParamsSchema.shape.roleId) })
  @ApiResponse({ status: 200, description: 'Detalle del rol (con permisos asociados).' })
  @ApiResponse({ status: 404, description: 'INTERNAL_ROLE_NOT_FOUND.' })
  @Get('internal/roles/:roleId')
  @InternalPermissions('internal.roles.read')
  getRole(
    @Param(new ZodValidationPipe(internalRoleParamsSchema)) params: InternalRoleParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.accessCatalogService.getRole(currentUser, params.roleId);
  }

  @ApiOperation({ summary: 'Listar permisos internos' })
  @ApiResponse({ status: 200, description: 'Lista de permisos internos.' })
  @Get('internal/permissions')
  @InternalPermissions('internal.permissions.read')
  listPermissions(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.accessCatalogService.listPermissions(currentUser);
  }
}
