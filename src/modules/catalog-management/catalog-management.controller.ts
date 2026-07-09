import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CatalogManagementService } from './catalog-management.service.js';
import {
  ActivateRiskRulesetVersionDto,
  CatalogCodeParamsDto,
  CatalogDecisionDto,
  CatalogIngestionDto,
  CatalogVersionParamsDto,
  CreateCatalogVersionDto,
  CreateRiskRulesetVersionDto,
  DataGovernancePolicyPackageDto,
  DefinitionsPackageDto,
  DefinitionsQueryDto,
  ListCatalogsQueryDto,
  RulesetVersionParamsDto,
  StagingDecisionBatchDto,
  SubmitCatalogVersionDto,
  activateRiskRulesetVersionSchema,
  catalogCodeParamsSchema,
  catalogDecisionSchema,
  catalogIngestionSchema,
  catalogVersionParamsSchema,
  createCatalogVersionSchema,
  createRiskRulesetVersionSchema,
  dataGovernancePolicyPackageSchema,
  definitionsPackageSchema,
  definitionsQuerySchema,
  listCatalogsQuerySchema,
  rulesetVersionParamsSchema,
  stagingDecisionBatchSchema,
  submitCatalogVersionSchema,
} from './catalog-management.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function contextFrom(tenantIdHeader: string | undefined, idempotencyKey: string | undefined, request: RequestWithNetwork): RequestContext {
  return {
    tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
    ipAddress: request.ip ?? null,
    userAgent: firstHeader(request.headers['user-agent']),
    idempotencyKey,
  };
}

function requireIdempotencyHeader(idempotencyKey: string | undefined): void {
  if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
}

@ApiTags('catalog-management')
@ApiBearerAuth('access-token')
@Controller('operations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class CatalogManagementController {
  constructor(private readonly service: CatalogManagementService) {}

  @ApiOperation({ summary: 'Listar catálogos de contexto' })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(listCatalogsQuerySchema).status })
  @ApiResponse({ status: 200, description: 'Lista de catálogos.' })
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
  @ApiResponse({ status: 200, description: 'Versión de catálogo.' })
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
  @ApiResponse({ status: 201, description: 'Versión de catálogo creada.' })
  @Post('catalogs/:catalogCode/versions')
  @HttpCode(HttpStatus.CREATED)
  createCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogCodeParamsSchema)) params: CatalogCodeParamsDto,
    @Body(new ZodValidationPipe(createCatalogVersionSchema)) body: CreateCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.createCatalogVersion({
      catalogCode: params.catalogCode,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Enviar una versión de catálogo a aprobación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogVersionParamsSchema.shape.catalogCode) })
  @ApiParam({ name: 'versionId', schema: zodToApiSchema(catalogVersionParamsSchema.shape.versionId) })
  @ApiBody({ schema: zodToApiSchema(submitCatalogVersionSchema) })
  @ApiResponse({ status: 200, description: 'Versión enviada a aprobación.' })
  @ApiResponse({ status: 404, description: 'CATALOG_VERSION_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CATALOG_VERSION_INVALID_STATE.' })
  @Post('catalogs/:catalogCode/versions/:versionId/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  submitCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(submitCatalogVersionSchema)) body: SubmitCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.submitCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Aprobar o rechazar una versión de catálogo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'catalogCode', schema: zodToApiSchema(catalogVersionParamsSchema.shape.catalogCode) })
  @ApiParam({ name: 'versionId', schema: zodToApiSchema(catalogVersionParamsSchema.shape.versionId) })
  @ApiBody({ schema: zodToApiSchema(catalogDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión registrada.' })
  @ApiResponse({ status: 404, description: 'CATALOG_VERSION_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CATALOG_VERSION_INVALID_STATE.' })
  @Post('catalogs/:catalogCode/versions/:versionId/decision')
  @HttpCode(HttpStatus.OK)
  decideCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(catalogDecisionSchema)) body: CatalogDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.decideCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Ingerir un catálogo (staging)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(catalogIngestionSchema) })
  @ApiResponse({ status: 201, description: 'Catálogo ingerido a staging.' })
  @Post('catalog-ingestions')
  @HttpCode(HttpStatus.CREATED)
  ingestCatalog(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(catalogIngestionSchema)) body: CatalogIngestionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.ingestCatalog({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Decidir en lote items en staging de catálogo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(stagingDecisionBatchSchema) })
  @ApiResponse({ status: 200, description: 'Decisiones aplicadas al lote de staging.' })
  @Post('catalog-staging-items/decision-batch')
  @HttpCode(HttpStatus.OK)
  decideStagingItems(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(stagingDecisionBatchSchema)) body: StagingDecisionBatchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.decideStagingItems({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Listar definiciones (glosario de datos)' })
  @ApiQuery({ name: 'type', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).type })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).status })
  @ApiQuery({ name: 'domain', required: false, schema: zodObjectPropertySchemas(definitionsQuerySchema).domain })
  @ApiResponse({ status: 200, description: 'Lista de definiciones.' })
  @Get('definitions')
  listDefinitions(
    @Query(new ZodValidationPipe(definitionsQuerySchema)) query: DefinitionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listDefinitions({ query, currentUser });
  }

  @ApiOperation({ summary: 'Publicar un paquete de definiciones (glosario)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(definitionsPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de definiciones aplicado.' })
  @Post('definitions/package')
  @HttpCode(HttpStatus.OK)
  upsertDefinitionsPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(definitionsPackageSchema)) body: DefinitionsPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.upsertDefinitionsPackage({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Obtener la política de riesgo activa' })
  @ApiResponse({ status: 200, description: 'Política de riesgo actual (ruleset activo).' })
  @Get('risk-policy/current')
  getCurrentRiskPolicy(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getCurrentRiskPolicy({ currentUser });
  }

  @ApiOperation({ summary: 'Crear una nueva versión de ruleset de riesgo (borrador)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createRiskRulesetVersionSchema) })
  @ApiResponse({ status: 201, description: 'Versión de ruleset creada.' })
  @Post('risk-policy/ruleset-versions')
  @HttpCode(HttpStatus.CREATED)
  createRiskRulesetVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createRiskRulesetVersionSchema)) body: CreateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.createRiskRulesetVersion({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Activar una versión de ruleset de riesgo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'rulesetVersionId', schema: zodToApiSchema(rulesetVersionParamsSchema.shape.rulesetVersionId) })
  @ApiBody({ schema: zodToApiSchema(activateRiskRulesetVersionSchema) })
  @ApiResponse({ status: 200, description: 'Versión de ruleset activada.' })
  @ApiResponse({ status: 404, description: 'RULESET_VERSION_NOT_FOUND.' })
  @Post('risk-policy/ruleset-versions/:rulesetVersionId/activate')
  @HttpCode(HttpStatus.OK)
  activateRiskRulesetVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(rulesetVersionParamsSchema)) params: RulesetVersionParamsDto,
    @Body(new ZodValidationPipe(activateRiskRulesetVersionSchema)) body: ActivateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.activateRiskRulesetVersion({
      rulesetVersionId: params.rulesetVersionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Obtener las políticas de gobernanza de datos activas' })
  @ApiResponse({ status: 200, description: 'Políticas de gobernanza (propósitos, clasificaciones, retenciones).' })
  @Get('data-governance/policies')
  getDataGovernancePolicies(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getDataGovernancePolicies({ currentUser });
  }

  @ApiOperation({ summary: 'Publicar un paquete de políticas de gobernanza de datos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(dataGovernancePolicyPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de gobernanza de datos aplicado.' })
  @Post('data-governance/policy-package')
  @HttpCode(HttpStatus.OK)
  upsertDataGovernancePackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(dataGovernancePolicyPackageSchema)) body: DataGovernancePolicyPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.upsertDataGovernancePackage({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }
}
