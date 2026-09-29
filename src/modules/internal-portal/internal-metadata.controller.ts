/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system expone el glosario de negocio y el linaje de datos del portal administrativo, paginados en la base.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { businessTermDetailResponseSchema, businessTermListResponseSchema } from './business-metadata.openapi.js';
import { InternalPortalService } from './internal-portal.service.js';
import { INTERNAL_PORTAL_ROLES } from './internal-portal.roles.js';
import {
  ApiLineageQuery,
  ApiPortalListQuery,
  lineageQuerySchema,
  LineageQueryDto,
  portalGlossaryQuerySchema,
  PortalGlossaryQueryDto,
  portalIdParamSchema,
} from './internal-portal.schemas.js';

/**
 * Glosario y linaje del portal interno.
 *
 * Salieron de `InternalPortalController` al declarar sus filtros (`domain`, `type`, `severity`,
 * `family`): esos filtros los mandaba el portal y Zod los descartaba en silencio, y documentarlos
 * dejaba aquel controller por encima del tope de tamaño. Mismas guardas, mismos roles, mismas rutas.
 */
@ApiTags('internal-portal')
@ApiBearerAuth('access-token')
@Controller('internal')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...INTERNAL_PORTAL_ROLES)
export class InternalMetadataController {
  // Las rutas que vinieron de InternalPortalController conservan su `operationId`: un cliente
  // generado a partir del contrato no debe cambiar por mover el código de archivo.
  constructor(private readonly service: InternalPortalService) {}

  @ApiOperation({
    operationId: 'InternalPortalController_listBusinessTerms',
    summary: 'Listar términos del glosario de negocio',
    description:
      'Dominios, tablas y campos catalogados, paginados en la base sobre el catálogo entero. `q` busca en clave, nombre, ' +
      'definición, dominio y dueño.',
  })
  @ApiPortalListQuery()
  @ApiQuery({
    name: 'domain',
    required: false,
    schema: zodObjectPropertySchemas(portalGlossaryQuerySchema).domain,
    description: 'Dominio exacto del término (sin distinguir mayúsculas); valores en `/business-metadata/glossary/facets`.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    schema: zodObjectPropertySchemas(portalGlossaryQuerySchema).type,
    description: 'Tipo de término: dominio, tabla o campo.',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de términos del glosario.', schema: businessTermListResponseSchema })
  @Get('business-metadata/glossary')
  listBusinessTerms(@Query(new ZodValidationPipe(portalGlossaryQuerySchema)) query: PortalGlossaryQueryDto) {
    return this.service.listBusinessTerms(query);
  }

  @ApiOperation({
    summary: 'Valores de los filtros del glosario',
    description: 'Dominios y tipos con su número de términos, contados sobre el catálogo entero y no sobre una página.',
  })
  @ApiResponse({ status: 200, description: '`domains` y `types`, cada uno `{ value, total }`.' })
  @Get('business-metadata/glossary/facets')
  listBusinessTermFacets() {
    return this.service.listBusinessTermFacets();
  }

  @ApiOperation({
    operationId: 'InternalPortalController_getBusinessTerm',
    summary: 'Obtener un término del glosario de negocio',
    description: 'Incluye sinónimos, restricciones, relaciones de datos y evidencia mínima de auditoría.',
  })
  @ApiParam({
    name: 'termId',
    schema: { type: 'string', pattern: '^(domain|table|field):.+$' },
    example: 'domain:RIESGO_CREDITO',
    description: 'Identificador retornado por el glosario; debe enviarse URL-encoded cuando corresponda.',
  })
  @ApiResponse({ status: 200, description: 'Detalle enriquecido del término.', schema: businessTermDetailResponseSchema })
  @ApiResponse({ status: 404, description: 'BUSINESS_TERM_NOT_FOUND.' })
  @Get('business-metadata/terms/:termId')
  getBusinessTerm(@Param(new ZodValidationPipe(portalIdParamSchema('termId'))) params: { termId: string }) {
    return this.service.getBusinessTerm(params.termId);
  }

  @ApiOperation({ operationId: 'InternalPortalController_getLineage', summary: 'Consultar el grafo de linaje de datos' })
  @ApiLineageQuery({ impact: false })
  @ApiResponse({ status: 200, description: 'Grafo de linaje de datos; `summary` dice cuánto se muestra de cuánto cumple el filtro.' })
  @Get('lineage')
  getLineage(@Query(new ZodValidationPipe(lineageQuerySchema)) query: LineageQueryDto) {
    return this.service.getLineage(query);
  }

  @ApiOperation({ operationId: 'InternalPortalController_getLineageNode', summary: 'Obtener un nodo de linaje de datos' })
  @ApiParam({ name: 'nodeId', description: '`table:<id>` o `endpoint:<id>`.' })
  @ApiResponse({ status: 200, description: 'Detalle del nodo de linaje con sus aristas de entrada y salida.' })
  @ApiResponse({ status: 404, description: 'LINEAGE_NODE_NOT_FOUND.' })
  @Get('lineage/nodes/:nodeId')
  getLineageNode(@Param(new ZodValidationPipe(portalIdParamSchema('nodeId'))) params: { nodeId: string }) {
    return this.service.getLineageNode(params.nodeId);
  }

  @ApiOperation({
    operationId: 'InternalPortalController_getLineageImpact',
    summary: 'Listar impactos y relaciones del linaje',
    description:
      'Aristas endpoint→tabla (con severidad) y tabla→tabla (sin severidad), paginadas en la base sobre el catálogo entero. ' +
      '`summary.bySeverity` y `summary.byFamily` cuentan todo lo filtrado.',
  })
  @ApiLineageQuery({ impact: true })
  @ApiResponse({ status: 200, description: 'Lista paginada de impactos de linaje.' })
  @Get('lineage/impact')
  getLineageImpact(@Query(new ZodValidationPipe(lineageQuerySchema)) query: LineageQueryDto) {
    return this.service.getLineageImpact(query);
  }
}
