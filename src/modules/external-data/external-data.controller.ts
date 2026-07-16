import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { actorId, assertCustomerAccess, customerScopeForConsentMutation } from './external-data-controller.util.js';
import { ExternalDataService } from './external-data.service.js';
import {
  approveProviderRequestSchema,
  ApproveProviderRequestDto,
  consentIdParamsSchema,
  ConsentIdParamsDto,
  customerIdParamsSchema,
  CustomerIdParamsDto,
  decisionPackageQuerySchema,
  DecisionPackageQueryDto,
  externalConsentSchema,
  ExternalConsentDto,
  externalDataRequestSchema,
  ExternalDataRequestDto,
  idempotencyAuditQuerySchema,
  IdempotencyAuditQueryDto,
  productionGateQuerySchema,
  ProductionGateQueryDto,
  providerCodeParamsSchema,
  ProviderCodeParamsDto,
  providerSlaQuerySchema,
  ProviderSlaQueryDto,
  providerRuntimePatchSchema,
  ProviderRuntimePatchDto,
  providerUsageQuerySchema,
  ProviderUsageQueryDto,
  providerCostPolicyPatchSchema,
  ProviderCostPolicyPatchDto,
  requestIdParamsSchema,
  RequestIdParamsDto,
  retentionPreviewQuerySchema,
  RetentionPreviewQueryDto,
  retryRequestSchema,
  RetryRequestDto,
  sanitizationAuditQuerySchema,
  SanitizationAuditQueryDto,
} from './external-data.schemas.js';

/**
 * Fase 2.2 del plan 10/10: este archivo agrupaba NUEVE clases de controller en 966 líneas. Los siete
 * verticales (kyc, bureau, payments, telco, facebook, whatsapp, digital-trust) viven ahora en
 * `controllers/`, y los helpers compartidos en `external-data-controller.util.ts`. Aquí quedan el
 * controller de ejecución (`external-data`) y el de administración (`admin/external-providers`).
 * Las rutas, guards, roles y comportamiento no cambian.
 */

@ApiTags('external-data')
@ApiBearerAuth('access-token')
@Controller('external-data')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class ExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Registrar consentimiento para un proveedor externo',
    description:
      'Registra el consentimiento del cliente para consultar un proveedor de datos externos específico (KYC, buró, telco, etc.).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalConsentSchema) })
  @ApiResponse({ status: 201, description: 'Consentimiento registrado.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó registrar consentimiento para otro cliente.' })
  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  createConsent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-forwarded-for') ipAddress: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodValidationPipe(externalConsentSchema)) body: ExternalConsentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.createConsent({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      ipAddress,
      userAgent,
    });
  }

  @ApiOperation({ summary: 'Listar consentimientos de proveedores externos de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Lista de consentimientos.' })
  @Get('consents/user/:customerId')
  listConsents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.listCustomerConsents({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @ApiOperation({ summary: 'Revocar consentimiento de proveedor externo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'consentId', schema: zodToApiSchema(consentIdParamsSchema.shape.consentId) })
  @ApiResponse({ status: 200, description: 'Consentimiento revocado.' })
  @ApiResponse({ status: 404, description: 'Consentimiento no encontrado.' })
  @Post('consents/:consentId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeConsent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(consentIdParamsSchema)) params: ConsentIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.revokeConsent({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      consentId: params.consentId,
      customerId: customerScopeForConsentMutation(currentUser),
    });
  }

  @ApiOperation({
    summary: 'Preflight de una solicitud a proveedor externo',
    description:
      'Evalúa consentimiento, política de costo, cuota y circuit breaker SIN ejecutar el proveedor ni guardar respuesta. Úsalo antes de proveedores costosos o en producción.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalDataRequestSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del preflight — wouldExecute indica si la ejecución real pasaría.' })
  @Post('requests/preview')
  @HttpCode(HttpStatus.OK)
  previewRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.previewExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({
    summary: 'Ejecutar solicitud a proveedor externo',
    description:
      'Ejecuta la consulta contra el proveedor (o devuelve una respuesta cacheada según TTL de política), registra costo/cuota, y persiste observaciones normalizadas + features.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(externalDataRequestSchema) })
  @ApiResponse({
    status: 200,
    description:
      'Resultado de la ejecución (COMPLETED, CACHED, BLOCKED_BY_COST_POLICY, RATE_LIMITED, MANUAL_APPROVAL_REQUIRED, CONSENT_REQUIRED, FAILED, etc.).',
  })
  @ApiResponse({ status: 403, description: 'Un customer intentó consultar datos de otro cliente.' })
  @Post('requests')
  @HttpCode(HttpStatus.OK)
  executeRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({ summary: 'Detalle de una solicitud a proveedor externo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiResponse({ status: 200, description: 'Detalle de la solicitud.' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada.' })
  @Get('requests/:requestId')
  getRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
    });
  }

  @ApiOperation({ summary: 'Estado de salud de proveedores externos' })
  @ApiQuery({ name: 'providerCode', required: false, description: 'Filtra por un proveedor específico; sin filtro devuelve todos.' })
  @ApiResponse({ status: 200, description: 'Estado de salud por proveedor.' })
  @Get('providers/health')
  getProviderHealth(@Query('providerCode') providerCode?: string) {
    return this.externalDataService.getProviderHealth(providerCode);
  }

  @ApiOperation({
    summary: 'Features derivados de datos externos de un cliente',
    description:
      'Devuelve los features normalizados (score de confianza, matches, etc.) computados a partir de todas las respuestas de proveedores externos del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features del cliente.' })
  @Get('users/:customerId/features')
  getUserFeatures(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @ApiOperation({ summary: 'Input de scoring de riesgo derivado de datos externos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Input de scoring del cliente.' })
  @Get('users/:customerId/scoring-input')
  getUserScoringInput(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerScoringInput({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @ApiOperation({
    summary: 'Paquete de decisión completo de un cliente',
    description:
      'Agrega features, observaciones y (opcionalmente) las respuestas crudas redactadas de todos los proveedores externos consultados, para un panel de decisión de riesgo/crédito.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiQuery({
    name: 'includeRawResponses',
    required: false,
    schema: zodObjectPropertySchemas(decisionPackageQuerySchema).includeRawResponses,
  })
  @ApiQuery({
    name: 'featureMaxAgeHours',
    required: false,
    schema: zodObjectPropertySchemas(decisionPackageQuerySchema).featureMaxAgeHours,
  })
  @ApiResponse({ status: 200, description: 'Paquete de decisión.' })
  @Get('users/:customerId/decision-package')
  getDecisionPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Query(new ZodValidationPipe(decisionPackageQuerySchema)) query: DecisionPackageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerDecisionPackage({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
      includeRawResponses: query.includeRawResponses,
      featureMaxAgeHours: query.featureMaxAgeHours,
    });
  }

  @ApiOperation({
    summary: 'Observaciones normalizadas de un cliente',
    description: 'Lista cruda de observaciones individuales (no agregadas a features) generadas por proveedores externos.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Observaciones del cliente.' })
  @Get('users/:customerId/observations')
  getUserObservations(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerObservations({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class AdminExternalProvidersController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({ summary: 'Listar catálogo de proveedores externos' })
  @ApiResponse({ status: 200, description: 'Catálogo de proveedores.' })
  @Get()
  listProviders() {
    return this.externalDataService.listProviders();
  }

  @ApiOperation({ summary: 'Salud de todos los proveedores externos' })
  @ApiResponse({ status: 200, description: 'Estado de salud por proveedor.' })
  @Get('health')
  health() {
    return this.externalDataService.getProviderHealth();
  }

  @ApiOperation({
    summary: 'Readiness de proveedores para producción',
    description: 'Evalúa si cada proveedor tiene credenciales/integración real lista para modo production.',
  })
  @ApiResponse({ status: 200, description: 'Reporte de readiness.' })
  @Get('readiness')
  readiness() {
    return this.externalDataService.getProviderReadiness();
  }

  @ApiOperation({
    summary: 'Auditoría de calidad de configuración de proveedores',
    description: 'Detecta configuraciones riesgosas (p. ej. HIGH_COST_NOT_BLOCKED — proveedor costoso sin gate de aprobación).',
  })
  @ApiResponse({ status: 200, description: 'Hallazgos de auditoría de calidad.' })
  @Get('quality-audit')
  qualityAudit() {
    return this.externalDataService.auditExternalProvidersQuality();
  }

  @ApiOperation({ summary: 'Gate de producción por proveedor' })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(productionGateQuerySchema).providerCode })
  @ApiQuery({ name: 'strict', required: false, schema: zodObjectPropertySchemas(productionGateQuerySchema).strict })
  @ApiResponse({ status: 200, description: 'Estado del gate de producción.' })
  @Get('production-gate')
  productionGate(@Query(new ZodValidationPipe(productionGateQuerySchema)) query: ProductionGateQueryDto) {
    return this.externalDataService.getProductionGate({ providerCode: query.providerCode, strict: query.strict });
  }

  @ApiOperation({ summary: 'Reporte de SLA por proveedor (latencia, tasa de éxito)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(providerSlaQuerySchema).providerCode })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(providerSlaQuerySchema).days })
  @ApiResponse({ status: 200, description: 'Reporte de SLA.' })
  @Get('sla')
  sla(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(providerSlaQuerySchema)) query: ProviderSlaQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderSlaReport({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @ApiOperation({ summary: 'Uso/costo acumulado por proveedor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(providerUsageQuerySchema).providerCode })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(providerUsageQuerySchema).days })
  @ApiResponse({ status: 200, description: 'Reporte de uso/costo.' })
  @Get('usage')
  usage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(providerUsageQuerySchema)) query: ProviderUsageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderUsage({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @ApiOperation({ summary: 'Auditoría de claves de idempotencia de solicitudes a proveedores' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(idempotencyAuditQuerySchema).days })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(idempotencyAuditQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Auditoría de idempotencia.' })
  @Get('idempotency-audit')
  idempotencyAudit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(idempotencyAuditQuerySchema)) query: IdempotencyAuditQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.auditIdempotencyKeys({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      days: query.days,
      limit: query.limit,
    });
  }

  @ApiOperation({
    summary: 'Vista previa de purga por retención',
    description: 'Simula qué respuestas de proveedores externos serían purgadas por política de retención, sin borrar nada.',
  })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(retentionPreviewQuerySchema).days })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(retentionPreviewQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Vista previa de purga.' })
  @Get('retention/preview')
  retentionPreview(@Query(new ZodValidationPipe(retentionPreviewQuerySchema)) query: RetentionPreviewQueryDto) {
    return this.externalDataService.getRetentionPreview({ days: query.days, limit: query.limit });
  }

  @ApiOperation({
    summary: 'Auditoría de sanitización de respuestas',
    description:
      'Verifica que las respuestas crudas persistidas de proveedores externos estén correctamente redactadas (sin PII en claro).',
  })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(sanitizationAuditQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Auditoría de sanitización.' })
  @Get('sanitization-audit')
  sanitizationAudit(@Query(new ZodValidationPipe(sanitizationAuditQuerySchema)) query: SanitizationAuditQueryDto) {
    return this.externalDataService.auditResponseSanitization({ limit: query.limit });
  }

  @ApiOperation({ summary: 'Vista previa de política (alias administrativo de requests/preview)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalDataRequestSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del preflight de política.' })
  @Post('policy/preview')
  @HttpCode(HttpStatus.OK)
  previewPolicy(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.previewExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  // Restringido a admin/platform_admin (auditoría de producción — ver docs/audit/external-data.md,
  // hallazgo 2): el `@Roles` de clase incluye `risk_analyst`/`compliance_analyst` para dar
  // visibilidad de solo lectura, pero este endpoint reconfigura en caliente el modo de
  // producción, estado y activación de un proveedor externo (KYC/crédito/telco/pagos) — una
  // acción de plataforma, no de investigación.
  @ApiOperation({
    summary: 'Reconfigurar modo/estado runtime de un proveedor (solo admin)',
    description:
      'Cambia en caliente el modo (mock_local/sandbox/production/disabled), estado activo/inactivo. Restringido a admin/platform_admin.',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiBody({ schema: zodToApiSchema(providerRuntimePatchSchema) })
  @ApiResponse({ status: 200, description: 'Política runtime actualizada.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @Roles('admin', 'platform_admin')
  @Patch(':providerCode/runtime')
  patchRuntime(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerRuntimePatchSchema)) body: ProviderRuntimePatchDto,
  ) {
    return this.externalDataService.updateProviderRuntimePolicy({ providerCode: params.providerCode, patch: body });
  }

  @ApiOperation({
    summary: 'Kill switch de emergencia de un proveedor',
    description: 'Desactiva inmediatamente un proveedor externo (p. ej. ante una fuga de datos o abuso de costo detectado).',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiBody({ schema: zodToApiSchema(providerRuntimePatchSchema) })
  @ApiResponse({ status: 200, description: 'Proveedor desactivado.' })
  @Post(':providerCode/kill-switch')
  @HttpCode(HttpStatus.OK)
  killSwitch(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerRuntimePatchSchema)) body: ProviderRuntimePatchDto,
  ) {
    return this.externalDataService.activateProviderKillSwitch({ providerCode: params.providerCode, reason: body.reason });
  }

  @ApiOperation({ summary: 'Listar políticas de costo de un proveedor (por tipo de consulta)' })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiResponse({ status: 200, description: 'Políticas de costo del proveedor.' })
  @Get(':providerCode/cost-policy')
  getCostPolicy(@Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto) {
    return this.externalDataService.getProviderCostPolicies(params.providerCode);
  }

  // Restringido a admin/platform_admin (ver docs/audit/external-data.md, hallazgo 2): edita la
  // política de costo/aprobación manual de un proveedor (incluye poder desactivar
  // `requiresManualApproval`/`blockByDefault` en una query de costo alto) — control financiero,
  // no de investigación de riesgo/cumplimiento.
  @ApiOperation({
    summary: 'Editar política de costo/aprobación de un proveedor (solo admin)',
    description: 'Control financiero — puede modificar requiresManualApproval/blockByDefault para un tipo de consulta de costo alto.',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiParam({ name: 'queryType', description: 'Tipo de consulta (p. ej. IDENTITY_VERIFICATION, CREDIT_CHECK).' })
  @ApiBody({ schema: zodToApiSchema(providerCostPolicyPatchSchema) })
  @ApiResponse({ status: 200, description: 'Política de costo actualizada.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @Roles('admin', 'platform_admin')
  @Patch(':providerCode/cost-policy/:queryType')
  updateCostPolicy(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Param('queryType') queryType: string,
    @Body(new ZodValidationPipe(providerCostPolicyPatchSchema)) body: ProviderCostPolicyPatchDto,
  ) {
    return this.externalDataService.updateProviderCostPolicy({ providerCode: params.providerCode, queryType, patch: body });
  }

  @ApiOperation({
    summary: 'Probar un proveedor con datos sintéticos',
    description:
      'Ejecuta una solicitud real de prueba contra el proveedor (útil para QA/debug), con valores por defecto razonables si no se envían.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiResponse({ status: 200, description: 'Resultado de la ejecución de prueba.' })
  @Post(':providerCode/test')
  @HttpCode(HttpStatus.OK)
  testProvider(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body() body: Record<string, unknown> = {},
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.executeExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body: {
        providerCode: params.providerCode,
        customerId: typeof body.customerId === 'string' ? body.customerId : '1',
        queryType: typeof body.queryType === 'string' ? body.queryType : 'IDENTITY_VERIFICATION',
        purpose: typeof body.purpose === 'string' ? body.purpose : 'MANUAL_REVIEW',
        decisionStage: typeof body.decisionStage === 'string' ? body.decisionStage : 'MANUAL_REVIEW',
        input: typeof body.input === 'object' && body.input !== null ? (body.input as Record<string, unknown>) : {},
        scenario: typeof body.scenario === 'string' ? body.scenario : undefined,
        approvedByAdminId: actorId(currentUser),
      },
      requestedByUserId: actorId(currentUser),
    });
  }

  // Restringido a admin/platform_admin (ver docs/audit/external-data.md, hallazgo 2): aprueba
  // una solicitud pendiente de revisión manual/costo alto para ejecución — es precisamente el
  // gate de control de costos que `auditExternalProvidersQuality` marca como CRITICAL si falta
  // (`HIGH_COST_NOT_BLOCKED`); dejarlo abierto a `risk_analyst`/`compliance_analyst` permitiría
  // que el mismo perfil que solicita datos costosos se autoapruebe.
  @ApiOperation({
    summary: 'Aprobar solicitud costosa/manual (solo admin)',
    description: 'Aprueba una solicitud bloqueada por política de costo o que requiere revisión manual, permitiendo su ejecución.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiBody({ schema: zodToApiSchema(approveProviderRequestSchema) })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada.' })
  @Roles('admin', 'platform_admin')
  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(approveProviderRequestSchema)) body: ApproveProviderRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.approveRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
      approvedByAdminId: body.approvedByAdminId ?? actorId(currentUser),
      approvalReason: body.approvalReason,
    });
  }

  @ApiOperation({ summary: 'Reintentar una solicitud fallida a proveedor externo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiBody({ schema: zodToApiSchema(retryRequestSchema) })
  @ApiResponse({ status: 200, description: 'Nueva solicitud de reintento creada.' })
  @ApiResponse({ status: 404, description: 'Solicitud original no encontrada.' })
  @Post('requests/:requestId/retry')
  @HttpCode(HttpStatus.OK)
  retryRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(retryRequestSchema)) body: RetryRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.retryProviderRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({
    summary: 'Reconstruir snapshot de features desde una respuesta existente',
    description:
      'Recalcula el snapshot de features a partir de la respuesta ya almacenada de una solicitud, sin volver a consultar al proveedor.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiResponse({ status: 200, description: 'Snapshot de features reconstruido.' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada.' })
  @Post('requests/:requestId/rebuild-features')
  @HttpCode(HttpStatus.OK)
  rebuildFeatures(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.rebuildFeatureSnapshotFromRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
    });
  }
}
