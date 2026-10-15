/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertCustomerAccess } from '../external-data-controller.util.js';
import { ExternalDataEvidenceService } from '../application/external-data-evidence.service.js';
import {
  customerIdParamsSchema,
  CustomerIdParamsDto,
  decisionPackageQuerySchema,
  DecisionPackageQueryDto,
} from '../external-data.schemas.js';

/**
 * Evidencia por cliente: features, input de scoring, paquete de decisión y observaciones.
 * Los `operationId` conservan el nombre del controller original (`ExternalDataController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data')
@ApiBearerAuth('access-token')
@Controller('external-data')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class ExternalDataCustomerEvidenceController {
  constructor(private readonly evidence: ExternalDataEvidenceService) {}

  @ApiOperation({
    operationId: 'ExternalDataController_getUserFeatures',
    summary: 'Features derivados de datos externos de un cliente',
    description:
      'Devuelve los features normalizados (score de confianza, matches, etc.) computados a partir de todas las respuestas de proveedores externos del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features del cliente.' })
  @Get('users/:customerId/features')
  getUserFeatures(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.evidence.getCustomerFeatures({
      tenantId: tenantId,
      customerId: params.customerId,
    });
  }

  @ApiOperation({
    operationId: 'ExternalDataController_getUserScoringInput',
    summary: 'Input de scoring de riesgo derivado de datos externos',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Input de scoring del cliente.' })
  @Get('users/:customerId/scoring-input')
  getUserScoringInput(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.evidence.getCustomerScoringInput({
      tenantId: tenantId,
      customerId: params.customerId,
    });
  }

  @ApiOperation({
    operationId: 'ExternalDataController_getDecisionPackage',
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
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Query(new ZodValidationPipe(decisionPackageQuerySchema)) query: DecisionPackageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.evidence.getCustomerDecisionPackage({
      tenantId: tenantId,
      customerId: params.customerId,
      includeRawResponses: query.includeRawResponses,
      featureMaxAgeHours: query.featureMaxAgeHours,
    });
  }

  @ApiOperation({
    operationId: 'ExternalDataController_getUserObservations',
    summary: 'Observaciones normalizadas de un cliente',
    description: 'Lista cruda de observaciones individuales (no agregadas a features) generadas por proveedores externos.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Observaciones del cliente.' })
  @Get('users/:customerId/observations')
  getUserObservations(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.evidence.getCustomerObservations({
      tenantId: tenantId,
      customerId: params.customerId,
    });
  }
}
