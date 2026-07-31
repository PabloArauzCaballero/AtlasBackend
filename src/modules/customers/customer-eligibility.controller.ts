/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { EligibilityDecisionDto, eligibilityDecisionSchema } from './customer-eligibility.schemas.js';
import { CustomerEligibilityDecisionService } from './application/customer-eligibility-decision.service.js';
import { CustomerEligibilityService } from './application/customer-eligibility.service.js';
import { CustomerIdParamsDto, customerIdParamsSchema } from './customers.schemas.js';

/**
 * Habilitación crediticia: consulta para el cliente y decisión para el analista.
 *
 * Es la única puerta de entrada a la pregunta "¿este cliente puede solicitar un crédito?". El
 * frontend debe consultarla para decidir si muestra el botón de solicitud — pero la seguridad no
 * está en ocultar el botón, sino en que cualquier endpoint que cree una solicitud vuelva a evaluar
 * esta misma regla antes de escribir nada.
 */
@ApiTags('customer-eligibility')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerEligibilityController {
  constructor(
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly decisionService: CustomerEligibilityDecisionService,
  ) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Habilitación crediticia del cliente',
    description:
      'Evalúa la regla de habilitación y devuelve `{ eligible, blockers[], sections[], completionPercentage, nextStep }`. ' +
      'Cada consulta deja una fila de evidencia en `customer_eligibility_evaluations` con la versión de la regla aplicada. ' +
      'Un `customer` solo puede consultar su propia habilitación.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Resultado de la evaluación, con la lista completa de bloqueadores.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó consultar la habilitación de otro cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get('customers/:customerId/eligibility')
  getEligibility(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.eligibilityService.getEligibility({ tenantId, customerId: params.customerId, currentUser });
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Decidir la habilitación de un cliente (operaciones)',
    description:
      'Aprueba, rechaza, observa, suspende o reincorpora a un cliente. La transición se valida contra la máquina de estados ' +
      'y se escribe junto a su evento de historial en la misma transacción. Aprobar con bloqueadores pendientes se registra ' +
      'como excepción autorizada (`decision_source = manual_override`), con la lista de bloqueadores omitidos.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(eligibilityDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión aplicada — estado anterior, estado nuevo y bloqueadores vigentes.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'INVALID_STATUS_TRANSITION — la máquina de estados no permite esa transición.' })
  @Post('operations/customers/:customerId/eligibility/decision')
  @HttpCode(HttpStatus.OK)
  decideEligibility(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Body(new ZodValidationPipe(eligibilityDecisionSchema)) body: EligibilityDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.decisionService.decide({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId: params.customerId,
      decision: body.decision,
      reasonCode: body.reasonCode,
      notes: body.notes ?? null,
      currentUser,
    });
  }
}
