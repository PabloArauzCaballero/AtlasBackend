/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que negocio edite lo que lee el cliente sin pasar por ingeniería.
 * @system expone el CRUD del catálogo de contenidos de la app.
 */
import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { GOVERNANCE_POLICY_READ_ROLES, GOVERNANCE_POLICY_WRITE_ROLES } from '../../common/utils/auth/role-groups.util.js';
import { AppContentService } from './app-content.service.js';
import {
  contentIdParamsSchema,
  listAdminContentQuerySchema,
  upsertContentSchema,
  type ContentIdParamsDto,
  type ListAdminContentQueryDto,
  type UpsertContentDto,
} from './app-content.schemas.js';

/**
 * El portal interno editando lo que la app enseña.
 *
 * Existe para que la respuesta a «esta pregunta frecuente confunde a la gente» o «cambió el número
 * de soporte» sea una edición y no un despliegue. Mientras el texto vivió en el código, cada cambio
 * de una frase costaba compilar, firmar, publicar en dos tiendas y esperar a que la gente
 * actualizara — con el resultado de que distintos clientes leían condiciones distintas según cuándo
 * hubieran actualizado.
 */
@ApiTags('app-content')
@ApiBearerAuth('access-token')
@Controller('operations/app-content')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AppContentOperationsController {
  constructor(private readonly service: AppContentService) {}

  @ApiOperation({ summary: 'Listar el contenido de la app, activo o no' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'surface', required: false, description: 'Sólo las piezas de esta pantalla de la app.' })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Busca por partes en la clave, el título, el subtítulo, el texto y la etiqueta del botón.',
  })
  @ApiQuery({ name: 'active', required: false, description: '`true` sólo las visibles en la app, `false` sólo las ocultas.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página, desde 1.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Piezas por página, de 1 a 100 (20 por omisión).' })
  @ApiResponse({
    status: 200,
    description: 'Página de piezas con su estado de publicación, `meta` y `summary` (total, visibles y ocultas de la pantalla).',
  })
  @Get()
  @Roles(...GOVERNANCE_POLICY_READ_ROLES)
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listAdminContentQuerySchema)) query: ListAdminContentQueryDto) {
    return this.service.listForAdmin(tenantId, {
      surface: query.surface,
      q: query.q,
      active: query.active,
      page: query.page,
      limit: query.limit,
    });
  }

  @ApiOperation({
    summary: 'Crear o reemplazar una pieza de contenido',
    description:
      'Idempotente por `surface` + `contentKey` + `locale`: reeditar la misma pieza la actualiza en vez de duplicarla. ' +
      'Los `bullets` son datos y no marcado, para que quien edita no tenga que saber Markdown para que se vea bien.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(upsertContentSchema) })
  @ApiResponse({ status: 200, description: 'Pieza guardada.' })
  @Put()
  @Roles(...GOVERNANCE_POLICY_WRITE_ROLES)
  upsert(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(upsertContentSchema)) body: UpsertContentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.upsert(tenantId, body, currentUser.sub ?? null);
  }

  @ApiOperation({
    summary: 'Retirar una pieza de contenido',
    description: 'Borrado lógico: lo que se le enseñó al cliente es evidencia de qué se le dijo y cuándo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'contentId', schema: zodToApiSchema(contentIdParamsSchema.shape.contentId) })
  @ApiResponse({ status: 200, description: 'Pieza retirada.' })
  @Delete(':contentId')
  @Roles(...GOVERNANCE_POLICY_WRITE_ROLES)
  remove(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(contentIdParamsSchema)) params: ContentIdParamsDto) {
    return this.service.remove(tenantId, params.contentId);
  }
}
