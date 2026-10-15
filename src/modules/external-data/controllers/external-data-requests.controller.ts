/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { actorId, assertCustomerAccess, customerScopeForConsentMutation, inlineApprovalBy } from '../external-data-controller.util.js';
import { ExternalDataPreviewService } from '../application/external-data-preview.service.js';
import { ExternalDataExecutionService } from '../application/external-data-execution.service.js';
import { ExternalDataEvidenceService } from '../application/external-data-evidence.service.js';
import { ExternalProviderRegistryService } from '../application/external-provider-registry.service.js';
import { externalDataRequestSchema, ExternalDataRequestDto, requestIdParamsSchema, RequestIdParamsDto } from '../external-data.schemas.js';

/**
 * Solicitudes a proveedores externos: preflight, ejecución, detalle y salud.
 * Los `operationId` conservan el nombre del controller original (`ExternalDataController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data')
@ApiBearerAuth('access-token')
@Controller('external-data')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class ExternalDataRequestsController {
  constructor(
    private readonly preview: ExternalDataPreviewService,
    private readonly execution: ExternalDataExecutionService,
    private readonly evidence: ExternalDataEvidenceService,
    private readonly registry: ExternalProviderRegistryService,
  ) {}

  @ApiOperation({
    operationId: 'ExternalDataController_previewRequest',
    summary: 'Preflight de una solicitud a proveedor externo',
    description:
      'Evalúa consentimiento, política de costo, cuota y circuit breaker SIN ejecutar el proveedor ni guardar respuesta. Úsalo antes de proveedores costosos o en producción.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(externalDataRequestSchema) })
  @ApiResponse({ status: 200, description: 'Resultado del preflight — wouldExecute indica si la ejecución real pasaría.' })
  /*
   * Sin `customer`: este endpoint deja elegir proveedor, tipo de consulta e `input` libres, así que un
   * cliente podía lanzar cualquier consulta (buró incluido) con datos del body. Los flujos del cliente
   * van por endpoints verticales que arman el `input` desde su expediente.
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  @Post('requests/preview')
  @HttpCode(HttpStatus.OK)
  previewRequest(
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

  @ApiOperation({
    operationId: 'ExternalDataController_executeRequest',
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
  /*
   * Sin `customer`: este endpoint deja elegir proveedor, tipo de consulta e `input` libres, así que un
   * cliente podía lanzar cualquier consulta (buró incluido) con datos del body. Los flujos del cliente
   * van por endpoints verticales que arman el `input` desde su expediente.
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  @Post('requests')
  @HttpCode(HttpStatus.OK)
  executeRequest(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.execution.executeExternalDataRequest({
      tenantId: tenantId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
      approvedByAdminId: inlineApprovalBy(currentUser, body.approvedByAdminId),
    });
  }

  @ApiOperation({ operationId: 'ExternalDataController_getRequest', summary: 'Detalle de una solicitud a proveedor externo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiResponse({ status: 200, description: 'Detalle de la solicitud.' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada.' })
  @Get('requests/:requestId')
  getRequest(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.evidence.getProviderRequest({
      tenantId: tenantId,
      requestId: params.requestId,
      // Un cliente sólo ve SUS solicitudes (404 si es de otro); el personal interno, las del tenant.
      customerId: customerScopeForConsentMutation(currentUser),
    });
  }

  // Sin `customer`: cada llamada ejecuta los checks de todos los proveedores y escribe un
  // `provider_health_logs` por cada uno; es un dato operativo, no del cliente.
  @ApiOperation({ operationId: 'ExternalDataController_getProviderHealth', summary: 'Estado de salud de proveedores externos' })
  @ApiQuery({ name: 'providerCode', required: false, description: 'Filtra por un proveedor específico; sin filtro devuelve todos.' })
  @ApiResponse({ status: 200, description: 'Estado de salud por proveedor.' })
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  @Get('providers/health')
  getProviderHealth(@Query('providerCode') providerCode?: string) {
    return this.registry.getProviderHealth(providerCode);
  }
}
