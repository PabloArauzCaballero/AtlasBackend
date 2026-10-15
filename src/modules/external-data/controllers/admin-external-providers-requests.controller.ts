/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { actorId, inlineApprovalBy } from '../external-data-controller.util.js';
import { ExternalDataEvidenceService } from '../application/external-data-evidence.service.js';
import { ExternalDataGovernanceService } from '../application/external-data-governance.service.js';
import { ExternalProviderConvenienceService } from '../application/external-provider-convenience.service.js';
import {
  approveProviderRequestSchema,
  ApproveProviderRequestDto,
  requestIdParamsSchema,
  RequestIdParamsDto,
  retryRequestSchema,
  RetryRequestDto,
} from '../external-data.schemas.js';

/**
 * Administración de solicitudes a proveedores: aprobar, reintentar y reconstruir features.
 * Los `operationId` conservan el nombre del controller original (`AdminExternalProvidersController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class AdminExternalProvidersRequestsController {
  constructor(
    private readonly evidence: ExternalDataEvidenceService,
    private readonly governance: ExternalDataGovernanceService,
    private readonly convenience: ExternalProviderConvenienceService,
  ) {}

  // Restringido a admin/platform_admin (ver docs/audit/external-data.md, hallazgo 2): aprueba
  // una solicitud pendiente de revisión manual/costo alto para ejecución — es precisamente el
  // gate de control de costos que `auditExternalProvidersQuality` marca como CRITICAL si falta
  // (`HIGH_COST_NOT_BLOCKED`); dejarlo abierto a `risk_analyst`/`compliance_analyst` permitiría
  // que el mismo perfil que solicita datos costosos se autoapruebe.
  @ApiOperation({
    operationId: 'AdminExternalProvidersController_approveRequest',
    summary: 'Aprobar solicitud costosa/manual (solo admin)',
    description:
      'Deja constancia de la aprobación de una solicitud retenida por política de costo o por revisión manual. No la ejecuta: hay que volver a lanzarla.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiBody({ schema: zodToApiSchema(approveProviderRequestSchema) })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso (solo admin/platform_admin).' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada.' })
  @ApiResponse({ status: 409, description: 'EXTERNAL_REQUEST_NOT_AWAITING_APPROVAL: la solicitud ya terminó o no necesitaba permiso.' })
  @Roles('admin', 'platform_admin')
  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(approveProviderRequestSchema)) body: ApproveProviderRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.governance.approveRequest({
      tenantId: tenantId,
      requestId: params.requestId,
      // La aprobación queda a nombre de quien la firma; `body.approvedByAdminId` no atribuye a otro.
      approvedByAdminId: actorId(currentUser),
      approvalReason: body.approvalReason,
    });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_retryRequest',
    summary: 'Reintentar una solicitud fallida a proveedor externo',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(requestIdParamsSchema.shape.requestId) })
  @ApiBody({ schema: zodToApiSchema(retryRequestSchema) })
  @ApiResponse({ status: 200, description: 'Nueva solicitud de reintento creada.' })
  @ApiResponse({ status: 404, description: 'Solicitud original no encontrada.' })
  @Post('requests/:requestId/retry')
  @HttpCode(HttpStatus.OK)
  retryRequest(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(retryRequestSchema)) body: RetryRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.convenience.retryProviderRequest({
      tenantId: tenantId,
      requestId: params.requestId,
      body,
      requestedByUserId: actorId(currentUser),
      approvedByAdminId: inlineApprovalBy(currentUser, body.approvedByAdminId),
    });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_rebuildFeatures',
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
  rebuildFeatures(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto) {
    return this.evidence.rebuildFeatureSnapshotFromRequest({
      tenantId: tenantId,
      requestId: params.requestId,
    });
  }
}
