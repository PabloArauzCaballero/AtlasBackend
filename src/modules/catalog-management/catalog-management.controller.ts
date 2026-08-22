/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { contextFrom } from './catalog-request-context.util.js';
import { CatalogManagementService } from './catalog-management.service.js';
import {
  catalogDecisionResponseSchema,
  catalogIngestionResponseSchema,
  catalogListResponseSchema,
  catalogVersionDetailResponseSchema,
  catalogVersionStatusResponseSchema,
  createCatalogVersionResponseSchema,
  definitionsPackageResponseSchema,
  definitionsResponseSchema,
  stagingDecisionResponseSchema,
} from './catalog-management.openapi.js';
import {
  CatalogCodeParamsDto,
  CatalogDecisionDto,
  CatalogIngestionDto,
  CatalogVersionParamsDto,
  CreateCatalogVersionDto,
  DefinitionsPackageDto,
  DefinitionsQueryDto,
  ListCatalogsQueryDto,
  StagingDecisionBatchDto,
  SubmitCatalogVersionDto,
  catalogCodeParamsSchema,
  catalogDecisionSchema,
  catalogIngestionSchema,
  catalogVersionParamsSchema,
  createCatalogVersionSchema,
  definitionsPackageSchema,
  definitionsQuerySchema,
  listCatalogsQuerySchema,
  stagingDecisionBatchSchema,
  submitCatalogVersionSchema,
} from './catalog-management.schemas.js';

@ApiTags('catalog-management')
@ApiBearerAuth('access-token')
@Controller('operations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class CatalogManagementController {
  constructor(private readonly service: CatalogManagementService) {}

  @ApiOperation({
    summary: 'Listar catálogos de contexto del motor de decisión',
    description: 'Devuelve los catálogos que normalizan señales de negocio y su versión más reciente.',
  })
  @ApiQuery({ name: 'domain', required: false, schema: zodObjectPropertySchemas(listCatalogsQuerySchema).domain })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(listCatalogsQuerySchema).status })
  @ApiQuery({ name: 'active', required: false, schema: zodObjectPropertySchemas(listCatalogsQuerySchema).active })
  @ApiResponse({ status: 200, description: 'Lista de catálogos y su versión vigente o más reciente.', schema: catalogListResponseSchema })
  @Get('catalogs')
  listCatalogs(
    @Query(new ZodValidationPipe(listCatalogsQuerySchema)) query: ListCatalogsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listCatalogs({ query, currentUser });
  }

  @ApiOperation({ summary: 'Obtener una versión de catálogo' })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogVersionParamsSchema.shape.catalogCode) })
  @ApiParam({ name: 'versionId', schema: zodToApiSchema(catalogVersionParamsSchema.shape.versionId) })
  @ApiResponse({
    status: 200,
    description: 'Versión, items, alias y mapeos de riesgo del catálogo.',
    schema: catalogVersionDetailResponseSchema,
  })
  @ApiResponse({ status: 404, description: 'CATALOG_VERSION_NOT_FOUND.' })
  @Get('catalogs/:catalogCode/versions/:versionId')
  getCatalogVersion(
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.getCatalogVersion({ catalogCode: params.catalogCode, versionId: params.versionId, currentUser });
  }

  @ApiOperation({ summary: 'Crear una nueva versión de catálogo (borrador)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogCodeParamsSchema.shape.catalogCode) })
  @ApiBody({ schema: zodToApiSchema(createCatalogVersionSchema) })
  @ApiResponse({ status: 201, description: 'Versión de catálogo creada.', schema: createCatalogVersionResponseSchema })
  @ApiResponse({ status: 404, description: 'Catálogo no encontrado.' })
  @Post('catalogs/:catalogCode/versions')
  @HttpCode(HttpStatus.CREATED)
  createCatalogVersion(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogCodeParamsSchema)) params: CatalogCodeParamsDto,
    @Body(new ZodValidationPipe(createCatalogVersionSchema)) body: CreateCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.createCatalogVersion({
      catalogCode: params.catalogCode,
      body,
      currentUser,
      context: contextFrom(tenantId, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Enviar una versión de catálogo a aprobación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogVersionParamsSchema.shape.catalogCode) })
  @ApiParam({ name: 'versionId', schema: zodToApiSchema(catalogVersionParamsSchema.shape.versionId) })
  @ApiBody({ schema: zodToApiSchema(submitCatalogVersionSchema) })
  @ApiResponse({ status: 200, description: 'Versión enviada a aprobación.', schema: catalogVersionStatusResponseSchema })
  @ApiResponse({ status: 404, description: 'CATALOG_VERSION_NOT_FOUND.' })
  @ApiResponse({ status: 422, description: 'CATALOG_VERSION_NOT_DRAFT o CATALOG_VERSION_WITHOUT_ITEMS.' })
  @Post('catalogs/:catalogCode/versions/:versionId/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  submitCatalogVersion(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(submitCatalogVersionSchema)) body: SubmitCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.submitCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantId, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Aprobar o rechazar una versión de catálogo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogVersionParamsSchema.shape.catalogCode) })
  @ApiParam({ name: 'versionId', schema: zodToApiSchema(catalogVersionParamsSchema.shape.versionId) })
  @ApiBody({ schema: zodToApiSchema(catalogDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión registrada.', schema: catalogDecisionResponseSchema })
  @ApiResponse({ status: 404, description: 'CATALOG_VERSION_NOT_FOUND.' })
  @ApiResponse({ status: 422, description: 'La versión no se encuentra en un estado compatible con la decisión.' })
  @Post('catalogs/:catalogCode/versions/:versionId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin')
  decideCatalogVersion(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(catalogDecisionSchema)) body: CatalogDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.decideCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantId, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Ingerir un catálogo (staging)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(catalogIngestionSchema) })
  @ApiResponse({ status: 201, description: 'Catálogo ingerido a staging.', schema: catalogIngestionResponseSchema })
  @ApiResponse({ status: 404, description: 'Catálogo no encontrado.' })
  @Post('catalog-ingestions')
  @HttpCode(HttpStatus.CREATED)
  ingestCatalog(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(catalogIngestionSchema)) body: CatalogIngestionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.ingestCatalog({ body, currentUser, context: contextFrom(tenantId, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Decidir en lote items en staging de catálogo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(stagingDecisionBatchSchema) })
  @ApiResponse({ status: 200, description: 'Decisiones aplicadas al lote de staging.', schema: stagingDecisionResponseSchema })
  @ApiResponse({ status: 404, description: 'Versión destino o item de staging no encontrado.' })
  @ApiResponse({ status: 422, description: 'Versión destino no editable o item incompatible/incompleto.' })
  @Post('catalog-staging-items/decision-batch')
  @HttpCode(HttpStatus.OK)
  decideStagingItems(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(stagingDecisionBatchSchema)) body: StagingDecisionBatchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.decideStagingItems({ body, currentUser, context: contextFrom(tenantId, idempotencyKey, request) });
  }

  @ApiOperation({
    summary: 'Listar definiciones semánticas del motor de decisión',
    description: 'Consulta observaciones, eventos, atributos y features que pueden alimentar reglas, scoring y explicabilidad.',
  })
  @ApiQuery({ name: 'type', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).type })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).status })
  @ApiQuery({ name: 'domain', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).domain })
  @ApiResponse({ status: 200, description: 'Definiciones agrupadas por tipo.', schema: definitionsResponseSchema })
  @Get('definitions')
  listDefinitions(
    @Query(new ZodValidationPipe(definitionsQuerySchema)) query: DefinitionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listDefinitions({ query, currentUser });
  }

  @ApiOperation({
    summary: 'Publicar un paquete de definiciones semánticas',
    description: 'Crea o actualiza en lote el vocabulario de señales disponible para un dominio de decisión.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(definitionsPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de definiciones aplicado.', schema: definitionsPackageResponseSchema })
  @Post('definitions/package')
  @HttpCode(HttpStatus.OK)
  upsertDefinitionsPackage(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(definitionsPackageSchema)) body: DefinitionsPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.upsertDefinitionsPackage({ body, currentUser, context: contextFrom(tenantId, idempotencyKey, request) });
  }
}
