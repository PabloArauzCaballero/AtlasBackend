import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_WRITE_ROLES } from './systems-ops.constants.js';
import {
  catalogSeedRefreshSchema,
  CatalogSeedRefreshDto,
  discoverEndpointsSchema,
  DiscoverEndpointsDto,
  inferToolRequirementsSchema,
  InferToolRequirementsDto,
  systemsEndpointParamsSchema,
  SystemsEndpointParamsDto,
  systemsEntityParamsSchema,
  SystemsEntityParamsDto,
  systemsListQuerySchema,
  SystemsListQueryDto,
  systemsTableImpactParamsSchema,
  SystemsTableImpactParamsDto,
  systemsToolParamsSchema,
  SystemsToolParamsDto,
} from './systems-ops.schemas.js';
import { SystemsCatalogQueryService } from './systems-catalog-query.service.js';
import { SystemsToolInferenceService } from './systems-tool-inference.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsCatalogController {
  constructor(
    private readonly service: SystemsCatalogQueryService,
    private readonly toolInferenceService: SystemsToolInferenceService,
  ) {}

  @ApiOperation({ summary: 'Dashboard resumen de systems-ops' })
  @ApiResponse({ status: 200, description: 'Contadores y resumen del catálogo interno.' })
  @Get('dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  @ApiOperation({ summary: 'Listar endpoints catalogados' })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).module })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).status })
  @ApiQuery({ name: 'riskLevel', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).riskLevel })
  @ApiQuery({ name: 'reviewStatus', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).reviewStatus })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de endpoints.' })
  @Get('endpoints')
  listEndpoints(@Query(new ZodValidationPipe(systemsListQuerySchema)) query: SystemsListQueryDto) {
    return this.service.listEndpoints(query);
  }

  @ApiOperation({ summary: 'Obtener un endpoint catalogado' })
  @ApiParam({ name: 'endpointId', schema: zodToApiSchema(systemsEndpointParamsSchema.shape.endpointId) })
  @ApiResponse({ status: 200, description: 'Detalle del endpoint.' })
  @ApiResponse({ status: 404, description: 'ENDPOINT_NOT_FOUND.' })
  @Get('endpoints/:endpointId')
  getEndpoint(@Param(new ZodValidationPipe(systemsEndpointParamsSchema)) params: SystemsEndpointParamsDto) {
    return this.service.getEndpoint(params.endpointId);
  }

  @ApiOperation({ summary: 'Descubrir endpoints (escaneo de código fuente)' })
  @ApiBody({ schema: zodToApiSchema(discoverEndpointsSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del descubrimiento de endpoints.' })
  @Post('endpoints/discover')
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  discoverEndpoints(@Body(new ZodValidationPipe(discoverEndpointsSchema)) body: DiscoverEndpointsDto) {
    return this.service.discoverEndpoints(body);
  }

  @ApiOperation({ summary: 'Refrescar el seed del catálogo (herramientas, entidades, endpoints)' })
  @ApiBody({ schema: zodToApiSchema(catalogSeedRefreshSchema) })
  @ApiResponse({ status: 200, description: 'Seed del catálogo refrescado.' })
  @Post('endpoints/catalog-seed/refresh')
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  refreshCatalogSeed(@Body(new ZodValidationPipe(catalogSeedRefreshSchema)) body: CatalogSeedRefreshDto) {
    return this.service.refreshCatalogSeed(body);
  }

  @ApiOperation({ summary: 'Listar herramientas catalogadas' })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).module })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).status })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de herramientas.' })
  @Get('tools')
  listTools(@Query(new ZodValidationPipe(systemsListQuerySchema)) query: SystemsListQueryDto) {
    return this.service.listTools(query);
  }

  @ApiOperation({ summary: 'Obtener una herramienta catalogada' })
  @ApiParam({ name: 'toolId', schema: zodToApiSchema(systemsToolParamsSchema.shape.toolId) })
  @ApiResponse({ status: 200, description: 'Detalle de la herramienta.' })
  @ApiResponse({ status: 404, description: 'TOOL_NOT_FOUND.' })
  @Get('tools/:toolId')
  getTool(@Param(new ZodValidationPipe(systemsToolParamsSchema)) params: SystemsToolParamsDto) {
    return this.service.getTool(params.toolId);
  }

  @ApiOperation({ summary: 'Inferir requisitos de herramientas (a partir del catálogo)' })
  @ApiBody({ schema: zodToApiSchema(inferToolRequirementsSchema) })
  @ApiResponse({ status: 200, description: 'Requisitos inferidos.' })
  @Post('tools/infer-requirements')
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  inferToolRequirements(@Body(new ZodValidationPipe(inferToolRequirementsSchema)) body: InferToolRequirementsDto) {
    return this.toolInferenceService.infer(body);
  }

  @ApiOperation({ summary: 'Listar entidades de datos catalogadas' })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).module })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).status })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de entidades de datos.' })
  @Get('data-entities')
  listDataEntities(@Query(new ZodValidationPipe(systemsListQuerySchema)) query: SystemsListQueryDto) {
    return this.service.listDataEntities(query);
  }

  @ApiOperation({ summary: 'Obtener una entidad de datos catalogada' })
  @ApiParam({ name: 'entityId', schema: zodToApiSchema(systemsEntityParamsSchema.shape.entityId) })
  @ApiResponse({ status: 200, description: 'Detalle de la entidad de datos.' })
  @ApiResponse({ status: 404, description: 'DATA_ENTITY_NOT_FOUND.' })
  @Get('data-entities/:entityId')
  getDataEntity(@Param(new ZodValidationPipe(systemsEntityParamsSchema)) params: SystemsEntityParamsDto) {
    return this.service.getDataEntity(params.entityId);
  }

  @ApiOperation({ summary: 'Actualizar metadata de una entidad de datos' })
  @ApiParam({ name: 'entityId', schema: zodToApiSchema(systemsEntityParamsSchema.shape.entityId) })
  @ApiBody({ description: 'Metadata libre a fusionar (objeto JSON arbitrario).' })
  @ApiResponse({ status: 200, description: 'Metadata actualizada.' })
  @ApiResponse({ status: 404, description: 'DATA_ENTITY_NOT_FOUND.' })
  @Patch('data-entities/:entityId/metadata')
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  updateDataEntityMetadata(
    @Param(new ZodValidationPipe(systemsEntityParamsSchema)) params: SystemsEntityParamsDto,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateDataEntityMetadata(params.entityId, body);
  }

  @ApiOperation({ summary: 'Impacto de datos de un endpoint' })
  @ApiParam({ name: 'endpointId', schema: zodToApiSchema(systemsEndpointParamsSchema.shape.endpointId) })
  @ApiResponse({ status: 200, description: 'Impacto de datos asociado al endpoint.' })
  @Get('impact/by-endpoint/:endpointId')
  getImpactByEndpoint(@Param(new ZodValidationPipe(systemsEndpointParamsSchema)) params: SystemsEndpointParamsDto) {
    return this.service.getImpactByEndpoint(params.endpointId);
  }

  @ApiOperation({ summary: 'Impacto de datos de una tabla' })
  @ApiParam({ name: 'schemaName', schema: zodToApiSchema(systemsTableImpactParamsSchema.shape.schemaName) })
  @ApiParam({ name: 'tableName', schema: zodToApiSchema(systemsTableImpactParamsSchema.shape.tableName) })
  @ApiResponse({ status: 200, description: 'Impacto de datos asociado a la tabla.' })
  @Get('impact/by-table/:schemaName/:tableName')
  getImpactByTable(@Param(new ZodValidationPipe(systemsTableImpactParamsSchema)) params: SystemsTableImpactParamsDto) {
    return this.service.getImpactByTable(params.schemaName, params.tableName);
  }

  @ApiOperation({ summary: 'Salud de herramientas catalogadas' })
  @ApiResponse({ status: 200, description: 'Estado de salud de las herramientas.' })
  @Get('health/tools')
  getToolsHealth() {
    return this.service.getToolsHealth();
  }
}
