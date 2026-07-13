import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_GOVERNANCE_ROLES } from './systems-ops.constants.js';
import {
  catalogSeedRefreshSchema,
  CatalogSeedRefreshDto,
  discoverEndpointsSchema,
  DiscoverEndpointsDto,
  inferToolRequirementsSchema,
  InferToolRequirementsDto,
  systemsEndpointParamsSchema,
  SystemsEndpointParamsDto,
  systemsDomainParamsSchema,
  SystemsDomainParamsDto,
  systemsEntityParamsSchema,
  SystemsEntityParamsDto,
  systemsListQuerySchema,
  SystemsListQueryDto,
  systemsTableImpactParamsSchema,
  SystemsTableImpactParamsDto,
  systemsToolParamsSchema,
  SystemsToolParamsDto,
  updateDataEntityMetadataSchema,
  UpdateDataEntityMetadataDto,
} from './systems-ops.schemas.js';
import { SystemsCatalogQueryService } from './systems-catalog-query.service.js';
import { SystemsToolInferenceService } from './systems-tool-inference.service.js';
import { SystemsDataImpactInferenceService } from './systems-data-impact-inference.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsCatalogController {
  constructor(
    private readonly service: SystemsCatalogQueryService,
    private readonly toolInferenceService: SystemsToolInferenceService,
    private readonly dataImpactInferenceService: SystemsDataImpactInferenceService,
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
  @ApiResponse({ status: 201, description: 'Resultado del descubrimiento de endpoints.' })
  @Post('endpoints/discover')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  discoverEndpoints(@Body(new ZodValidationPipe(discoverEndpointsSchema)) body: DiscoverEndpointsDto) {
    return this.service.discoverEndpoints(body);
  }

  @ApiOperation({ summary: 'Refrescar el seed del catálogo (herramientas, entidades, endpoints)' })
  @ApiBody({ schema: zodToApiSchema(catalogSeedRefreshSchema) })
  @ApiResponse({ status: 201, description: 'Seed del catálogo refrescado.' })
  @Post('endpoints/catalog-seed/refresh')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  refreshCatalogSeed(
    @Body(new ZodValidationPipe(catalogSeedRefreshSchema)) body: CatalogSeedRefreshDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.refreshCatalogSeed(body, user);
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
  @ApiResponse({ status: 201, description: 'Requisitos inferidos.' })
  @Post('tools/infer-requirements')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  inferToolRequirements(@Body(new ZodValidationPipe(inferToolRequirementsSchema)) body: InferToolRequirementsDto) {
    return this.toolInferenceService.infer(body);
  }

  @ApiOperation({ summary: 'Inferir impactos endpoint-tabla (a partir del código fuente)' })
  @ApiBody({ schema: zodToApiSchema(inferToolRequirementsSchema) })
  @ApiResponse({ status: 201, description: 'Impactos endpoint-tabla inferidos.' })
  @Post('data-entities/infer-impacts')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  inferDataImpacts(@Body(new ZodValidationPipe(inferToolRequirementsSchema)) body: InferToolRequirementsDto) {
    return this.dataImpactInferenceService.infer(body);
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

  @ApiOperation({ summary: 'Listar dominios de negocio catalogados (con descripción y owner)' })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de dominios.' })
  @Get('domains')
  listDomains(@Query(new ZodValidationPipe(systemsListQuerySchema)) query: SystemsListQueryDto) {
    return this.service.listDomains(query);
  }

  @ApiOperation({ summary: 'Obtener un dominio catalogado por código' })
  @ApiParam({ name: 'domainCode', schema: zodToApiSchema(systemsDomainParamsSchema.shape.domainCode) })
  @ApiResponse({ status: 200, description: 'Detalle del dominio.' })
  @ApiResponse({ status: 404, description: 'SYSTEM_DOMAIN_NOT_FOUND.' })
  @Get('domains/:domainCode')
  getDomain(@Param(new ZodValidationPipe(systemsDomainParamsSchema)) params: SystemsDomainParamsDto) {
    return this.service.getDomain(params.domainCode);
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
  @ApiBody({ schema: zodToApiSchema(updateDataEntityMetadataSchema) })
  @ApiResponse({ status: 200, description: 'Metadata actualizada.' })
  @ApiResponse({ status: 404, description: 'DATA_ENTITY_NOT_FOUND.' })
  @Patch('data-entities/:entityId/metadata')
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  updateDataEntityMetadata(
    @Param(new ZodValidationPipe(systemsEntityParamsSchema)) params: SystemsEntityParamsDto,
    @Body(new ZodValidationPipe(updateDataEntityMetadataSchema)) body: UpdateDataEntityMetadataDto,
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
