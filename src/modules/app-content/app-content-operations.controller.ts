/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que negocio edite lo que lee el cliente sin pasar por ingeniería.
 * @system expone el CRUD del catálogo de contenidos de la app.
 */
import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { AppContentService } from './app-content.service.js';
import {
  contentIdParamsSchema,
  listContentQuerySchema,
  upsertContentSchema,
  type ContentIdParamsDto,
  type ListContentQueryDto,
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
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class AppContentOperationsController {
  constructor(private readonly service: AppContentService) {}

  @ApiOperation({ summary: 'Listar el contenido de la app, activo o no' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Piezas de contenido con su estado de publicación.' })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listContentQuerySchema)) query: ListContentQueryDto) {
    return this.service.listForAdmin(tenantId, { surface: query.surface });
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
  remove(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(contentIdParamsSchema)) params: ContentIdParamsDto) {
    return this.service.remove(tenantId, params.contentId);
  }
}
