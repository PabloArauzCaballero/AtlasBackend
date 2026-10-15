/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { actorId, assertCustomerAccess, inlineApprovalBy } from '../external-data-controller.util.js';
import { ExternalDataPreviewService } from '../application/external-data-preview.service.js';
import { ExternalProviderRegistryService } from '../application/external-provider-registry.service.js';
import { ExternalProviderReadinessService } from '../application/external-provider-readiness.service.js';
import { ExternalProviderReportingService } from '../application/external-provider-reporting.service.js';
import {
  externalDataRequestSchema,
  ExternalDataRequestDto,
  idempotencyAuditQuerySchema,
  IdempotencyAuditQueryDto,
  productionGateQuerySchema,
  ProductionGateQueryDto,
  providerSlaQuerySchema,
  ProviderSlaQueryDto,
  providerUsageQuerySchema,
  ProviderUsageQueryDto,
  retentionPreviewQuerySchema,
  RetentionPreviewQueryDto,
  sanitizationAuditQuerySchema,
  SanitizationAuditQueryDto,
} from '../external-data.schemas.js';

/**
 * Administración de proveedores: catálogo, salud, calidad, SLA, uso y auditorías (solo lectura).
 * Los `operationId` conservan el nombre del controller original (`AdminExternalProvidersController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class AdminExternalProvidersReportsController {
  constructor(
    private readonly preview: ExternalDataPreviewService,
    private readonly registry: ExternalProviderRegistryService,
    private readonly providerReadiness: ExternalProviderReadinessService,
    private readonly reporting: ExternalProviderReportingService,
  ) {}

  @ApiOperation({ operationId: 'AdminExternalProvidersController_listProviders', summary: 'Listar catálogo de proveedores externos' })
  @ApiResponse({ status: 200, description: 'Catálogo de proveedores.' })
  @Get()
  listProviders() {
    return this.registry.listProviders();
  }

  @ApiOperation({ operationId: 'AdminExternalProvidersController_health', summary: 'Salud de todos los proveedores externos' })
  @ApiResponse({ status: 200, description: 'Estado de salud por proveedor.' })
  @Get('health')
  health() {
    return this.registry.getProviderHealth();
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_readiness',
    summary: 'Readiness de proveedores para producción',
    description: 'Evalúa si cada proveedor tiene credenciales/integración real lista para modo production.',
  })
  @ApiResponse({ status: 200, description: 'Reporte de readiness.' })
  @Get('readiness')
  readiness() {
    return this.providerReadiness.getProviderReadiness();
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_qualityAudit',
    summary: 'Auditoría de calidad de configuración de proveedores',
    description: 'Detecta configuraciones riesgosas (p. ej. HIGH_COST_NOT_BLOCKED — proveedor costoso sin gate de aprobación).',
  })
  @ApiResponse({ status: 200, description: 'Hallazgos de auditoría de calidad.' })
  @Get('quality-audit')
  qualityAudit() {
    return this.providerReadiness.auditExternalProvidersQuality();
  }

  @ApiOperation({ operationId: 'AdminExternalProvidersController_productionGate', summary: 'Gate de producción por proveedor' })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(productionGateQuerySchema).providerCode })
  @ApiQuery({ name: 'strict', required: false, schema: zodObjectPropertySchemas(productionGateQuerySchema).strict })
  @ApiResponse({ status: 200, description: 'Estado del gate de producción.' })
  @Get('production-gate')
  productionGate(@Query(new ZodValidationPipe(productionGateQuerySchema)) query: ProductionGateQueryDto) {
    return this.providerReadiness.getProductionGate({ providerCode: query.providerCode, strict: query.strict });
  }

  @ApiOperation({ operationId: 'AdminExternalProvidersController_sla', summary: 'Reporte de SLA por proveedor (latencia, tasa de éxito)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(providerSlaQuerySchema).providerCode })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(providerSlaQuerySchema).days })
  @ApiResponse({ status: 200, description: 'Reporte de SLA.' })
  @Get('sla')
  sla(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(providerSlaQuerySchema)) query: ProviderSlaQueryDto) {
    return this.reporting.getProviderSlaReport({
      tenantId: tenantId,
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @ApiOperation({ operationId: 'AdminExternalProvidersController_usage', summary: 'Uso/costo acumulado por proveedor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(providerUsageQuerySchema).providerCode })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(providerUsageQuerySchema).days })
  @ApiResponse({ status: 200, description: 'Reporte de uso/costo.' })
  @Get('usage')
  usage(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(providerUsageQuerySchema)) query: ProviderUsageQueryDto) {
    return this.reporting.getProviderUsage({
      tenantId: tenantId,
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_idempotencyAudit',
    summary: 'Auditoría de claves de idempotencia de solicitudes a proveedores',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(idempotencyAuditQuerySchema).days })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(idempotencyAuditQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Auditoría de idempotencia.' })
  @Get('idempotency-audit')
  idempotencyAudit(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(idempotencyAuditQuerySchema)) query: IdempotencyAuditQueryDto,
  ) {
    return this.reporting.auditIdempotencyKeys({
      tenantId: tenantId,
      days: query.days,
      limit: query.limit,
    });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_retentionPreview',
    summary: 'Vista previa de purga por retención',
    description: 'Simula qué respuestas de proveedores externos serían purgadas por política de retención, sin borrar nada.',
  })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(retentionPreviewQuerySchema).days })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(retentionPreviewQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Vista previa de purga.' })
  @Get('retention/preview')
  retentionPreview(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(retentionPreviewQuerySchema)) query: RetentionPreviewQueryDto,
  ) {
    return this.reporting.getRetentionPreview({ tenantId, days: query.days, limit: query.limit });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_sanitizationAudit',
    summary: 'Auditoría de sanitización de respuestas',
    description:
      'Verifica que las respuestas crudas persistidas de proveedores externos estén correctamente redactadas (sin PII en claro).',
  })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(sanitizationAuditQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Auditoría de sanitización.' })
  @Get('sanitization-audit')
  sanitizationAudit(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(sanitizationAuditQuerySchema)) query: SanitizationAuditQueryDto,
  ) {
    return this.reporting.auditResponseSanitization({ tenantId, limit: query.limit });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_previewPolicy',
    summary: 'Vista previa de política (alias administrativo de requests/preview)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalDataRequestSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del preflight de política.' })
  @Post('policy/preview')
  @HttpCode(HttpStatus.OK)
  previewPolicy(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.preview.previewExternalDataRequest({
      tenantId: tenantId,
      body,
      requestedByUserId: actorId(currentUser),
      approvedByAdminId: inlineApprovalBy(currentUser, body.approvedByAdminId),
    });
  }
}
