/**
 * @file Adaptador HTTP: los disparos manuales de los jobs que cierran el bucle con el Motor.
 * @business Permite adelantar la entrega de desenlaces y la calificación tras una incidencia, sin esperar al reloj.
 * @system expone POST /operations/jobs/{dispatch-loan-outcomes,sweep-debt-ratings} con los roles de jobs.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { DebtRatingService } from '../credit-rating/application/debt-rating.service.js';
import { OutcomeDispatchService } from '../decision-engine/outcome-dispatch.service.js';
import {
  DispatchLoanOutcomesDto,
  dispatchLoanOutcomesSchema,
  SweepDebtRatingsDto,
  sweepDebtRatingsSchema,
} from './runtime-jobs.schemas.js';

/**
 * Los dos jobs que cierran el bucle de la cartera, disparables a mano tras una incidencia.
 *
 * Vivían en `operations/loans` y `operations/credit-rating` como botones de runbook del portal, y
 * eran la ÚNICA forma de que ocurrieran: mientras nadie los pulsara, `loan_outcome_reports` crecía
 * sin vaciarse y la calificación vigente era la del último que se acordó de pedirla. Ahora corren
 * solos (`dispatch_loan_outcomes` cada 15 min, `sweep_debt_ratings` cada 6 h); estos disparos son
 * el mismo camino con los mismos roles que el resto de jobs, para cuando hay que adelantar el reloj.
 *
 * Controlador aparte y no dos métodos más en `RuntimeJobsController`: aquel ya estaba en el límite
 * de tamaño del gate, y estos dos comparten un propósito propio —el circuito con el Motor— que
 * justifica leerlos juntos.
 */
@ApiTags('runtime-jobs')
@ApiBearerAuth('access-token')
@Controller('operations/jobs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'system')
export class RuntimeDecisionJobsController {
  constructor(
    private readonly debtRating: DebtRatingService,
    private readonly outcomeDispatch: OutcomeDispatchService,
  ) {}

  @ApiOperation({
    summary: 'Entregar al Motor los desenlaces de cosecha pendientes (job dispatch_loan_outcomes)',
    description: 'El Motor deduplica por (ejecución, ventana): repetir un lote es seguro. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(dispatchLoanOutcomesSchema) })
  @ApiResponse({ status: 200, description: 'Desenlaces entregados, fallidos y omitidos.' })
  @Post('dispatch-loan-outcomes')
  @HttpCode(HttpStatus.OK)
  dispatchLoanOutcomes(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(dispatchLoanOutcomesSchema)) body: DispatchLoanOutcomesDto,
  ) {
    return this.outcomeDispatch.dispatchPending({ tenantId: requireTenantWithKey(tenantId, idempotencyKey), limit: body.limit });
  }

  @ApiOperation({
    summary: 'Recalificar la cartera con la política vigente (job sweep_debt_ratings)',
    description: 'Recorre los clientes con deuda viva y recalifica cada operación y su ficha. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(sweepDebtRatingsSchema) })
  @ApiResponse({ status: 200, description: 'Clientes recorridos, calificados y fallidos.' })
  @Post('sweep-debt-ratings')
  @HttpCode(HttpStatus.OK)
  sweepDebtRatings(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(sweepDebtRatingsSchema)) body: SweepDebtRatingsDto,
  ) {
    return this.debtRating.sweep({ tenantId: requireTenantWithKey(tenantId, idempotencyKey), limit: body.limit });
  }
}

/** El tenant de la sesión, tras exigir la llave de idempotencia que estos disparos comparten. */
function requireTenantWithKey(tenantId: string, idempotencyKey: string | undefined): string {
  requireIdempotencyKey(idempotencyKey);
  return tenantId;
}
