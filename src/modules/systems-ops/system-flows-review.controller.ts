/**
 * @file Controlador HTTP: expone la revisión humana de flujos y la compuerta de documentación.
 * @business Esta pieza deja que una persona confirme lo que dedujo el análisis y que se sepa si se puede certificar.
 * @system valida la entrada con Zod, aplica el permiso fino de cada ruta y delega en los servicios de revisión y compuerta.
 */
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from './systems-actor.util.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { SYSTEMS_OPS_ROLES } from './systems-ops.constants.js';
import { SystemFlowsGateService } from './system-flows.gate.service.js';
import { SystemFlowsReviewService } from './system-flows.review.service.js';
import {
  flowReviewDecisionSchema,
  flowReviewQueueSchema,
  type FlowReviewDecisionDto,
  type FlowReviewQueueDto,
} from './system-flows.review.schemas.js';
import { flowIdParamsSchema, type FlowIdParamsDto } from './system-flows.schemas.js';

/**
 * Roles de SESIÓN que llegan a estas rutas, y por qué incluyen `internal_operator`.
 *
 * El permiso de revisar lo dan los paquetes RBAC `SUPER_ADMIN`, `SYSTEMS_ADMIN` y
 * `DATA_GOVERNANCE_MANAGER`. Pero el rol de sesión de un interno sale de
 * `legacyRoleForInternalRoles`, que convierte `DATA_GOVERNANCE_MANAGER` en `internal_operator`, y los
 * roles de clase de Systems Ops no lo admiten: el único paquete pensado para revisar recibía 403 antes
 * de que nadie mirara su permiso.
 *
 * Admitir `internal_operator` no abre nada por sí solo. Cada ruta exige además su permiso fino
 * (`InternalPermissionsGuard`), así que el rol grueso sólo deja pasar a la comprobación que decide.
 */
const ROLES_DE_REVISION = [...SYSTEMS_OPS_ROLES, 'internal_operator'] as const;

/**
 * Se registra ANTES que `SystemFlowsController` en el módulo: sus `GET` (`flows/review-queue`,
 * `flows/documentation-gate`) chocarían si no con `GET flows/:flowId`, que los leería como un id.
 */
@Controller('systems')
@UseGuards(InternalPermissionsGuard)
@SystemsOpsControllerSecurity()
export class SystemFlowsReviewController {
  constructor(
    private readonly review: SystemFlowsReviewService,
    private readonly gate: SystemFlowsGateService,
  ) {}

  @ApiOperation({
    summary: 'FLOW_DOCUMENTATION_GATE: si se puede certificar la documentación de flujos hoy',
    description:
      'Cada comprobación con su cifra. Sin uso observado de pantallas, la de deriva no pasa: no se afirma lo que no se ha podido mirar.',
  })
  @ApiResponse({ status: 200, description: 'Resultado y comprobaciones.' })
  @Roles(...ROLES_DE_REVISION)
  @InternalPermissions('systems.flows.read')
  @Get('flows/documentation-gate')
  documentationGate() {
    return this.gate.evaluate();
  }

  @ApiOperation({
    summary: 'Cola de revisión humana de flujos',
    description:
      'Flujos de riesgo alto cuyo análisis no se puede dar por bueno solo, y los ya revisados cuyo código cambió. Cada fila lleva la huella del código actual, que hay que devolver al decidir.',
  })
  @ApiResponse({ status: 200, description: 'Flujos a revisar, con el motivo y la huella de cada uno.' })
  @Roles(...ROLES_DE_REVISION)
  @InternalPermissions('systems.flows.read')
  @Get('flows/review-queue')
  reviewQueue(@Query(new ZodValidationPipe(flowReviewQueueSchema)) query: FlowReviewQueueDto) {
    return this.review.queue(query);
  }

  @ApiOperation({
    summary: 'Revisar un flujo: aprobar, rechazar o devolver a revisión',
    description: 'Exige la huella del código que se revisó. Si el código cambió desde que se cargó la cola, responde 409 y no decide nada.',
  })
  @ApiParam({ name: 'flowId', schema: zodToApiSchema(flowIdParamsSchema.shape.flowId) })
  @ApiBody({ schema: zodToApiSchema(flowReviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión aplicada, con la huella del código sobre el que se tomó.' })
  @ApiResponse({ status: 404, description: 'No existe el flujo.' })
  @ApiResponse({ status: 409, description: 'El código del flujo cambió desde que se cargó la cola.' })
  @Roles(...ROLES_DE_REVISION)
  @InternalPermissions('systems.flows.review')
  @Patch('flows/:flowId/review')
  reviewFlow(
    @Param(new ZodValidationPipe(flowIdParamsSchema)) params: FlowIdParamsDto,
    @Body(new ZodValidationPipe(flowReviewDecisionSchema)) body: FlowReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.review.review(params.flowId, body, { id: actorId(user), role: user.role, tenantId: user.tenantId ?? null });
  }
}
