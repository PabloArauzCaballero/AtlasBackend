/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { actorId, providerProbeRequest } from '../external-data-controller.util.js';
import { providerProbeSchema, ProviderProbeDto } from '../external-data-probe.schemas.js';
import { ExternalDataExecutionService } from '../application/external-data-execution.service.js';
import { ExternalDataGovernanceService } from '../application/external-data-governance.service.js';
import {
  providerCodeParamsSchema,
  ProviderCodeParamsDto,
  providerRuntimePatchSchema,
  ProviderRuntimePatchDto,
  providerCostPolicyPatchSchema,
  ProviderCostPolicyPatchDto,
} from '../external-data.schemas.js';

/**
 * Administración de proveedores: modo runtime, kill switch, políticas de costo y pruebas.
 * Los `operationId` conservan el nombre del controller original (`AdminExternalProvidersController`): son contrato público (SDK
 * generados) y no cambian al partir el controller por subrecurso.
 */
@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class AdminExternalProvidersConfigController {
  constructor(
    private readonly execution: ExternalDataExecutionService,
    private readonly governance: ExternalDataGovernanceService,
  ) {}

  // Restringido a admin/platform_admin (auditoría de producción — ver docs/audit/external-data.md,
  // hallazgo 2): el `@Roles` de clase incluye `risk_analyst`/`compliance_analyst` para dar
  // visibilidad de solo lectura, pero este endpoint reconfigura en caliente el modo de
  // producción, estado y activación de un proveedor externo (KYC/crédito/telco/pagos) — una
  // acción de plataforma, no de investigación.
  @ApiOperation({
    operationId: 'AdminExternalProvidersController_patchRuntime',
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
    return this.governance.updateProviderRuntimePolicy({ providerCode: params.providerCode, patch: body });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_killSwitch',
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
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.governance.activateProviderKillSwitch({
      providerCode: params.providerCode,
      reason: body.reason,
      activatedBy: actorId(currentUser),
    });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_getCostPolicy',
    summary: 'Listar políticas de costo de un proveedor (por tipo de consulta)',
  })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiResponse({ status: 200, description: 'Políticas de costo del proveedor.' })
  @Get(':providerCode/cost-policy')
  getCostPolicy(@Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto) {
    return this.governance.getProviderCostPolicies(params.providerCode);
  }

  // Restringido a admin/platform_admin (ver docs/audit/external-data.md, hallazgo 2): edita la
  // política de costo/aprobación manual de un proveedor (incluye poder desactivar
  // `requiresManualApproval`/`blockByDefault` en una query de costo alto) — control financiero,
  // no de investigación de riesgo/cumplimiento.
  @ApiOperation({
    operationId: 'AdminExternalProvidersController_updateCostPolicy',
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
    return this.governance.updateProviderCostPolicy({ providerCode: params.providerCode, queryType, patch: body });
  }

  @ApiOperation({
    operationId: 'AdminExternalProvidersController_testProvider',
    summary: 'Probar un proveedor con datos sintéticos',
    description:
      'Ejecuta una solicitud real de prueba contra el proveedor (útil para QA/debug), con valores por defecto razonables si no se envían.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'providerCode', schema: zodToApiSchema(providerCodeParamsSchema.shape.providerCode) })
  @ApiBody({ required: false, schema: zodToApiSchema(providerProbeSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la ejecución de prueba.' })
  @Post(':providerCode/test')
  @HttpCode(HttpStatus.OK)
  testProvider(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerProbeSchema)) body: ProviderProbeDto = {},
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.execution.executeExternalDataRequest(providerProbeRequest(tenantId, params.providerCode, body, currentUser));
  }
}
