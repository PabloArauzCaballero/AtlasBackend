/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza cierra el bucle: el motor llega a saber si acertó al decidir.
 * @system expone el barrido de mora y la entrega de desenlaces como operaciones explícitas.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OutcomeDispatchService } from '../decision-engine/outcome-dispatch.service.js';
import { LoanDelinquencyService } from './application/loan-delinquency.service.js';
import { LoanQueryService } from './application/loan-query.service.js';
import { type ListLoansQueryDto, listLoansQuerySchema, LoanSweepDto, loanSweepSchema } from './loans.schemas.js';

/**
 * Operación del libro: recalcular mora y entregar desenlaces al motor.
 *
 * Son dos pasos y no uno solo a propósito. El barrido produce observaciones y la entrega las manda;
 * separarlos permite recalcular la mora aunque el motor esté caído, que es justo cuando conviene
 * que la cartera siga midiéndose. El estado queda en la cola y se entrega cuando el motor vuelva.
 *
 * Expuestos como endpoints y no sólo como trabajo programado porque la operación necesita poder
 * forzarlos —tras una incidencia, antes de un cierre— y porque así el runbook es una llamada y no
 * un acceso a la base.
 */
@ApiTags('loans-operations')
@ApiBearerAuth('access-token')
@Controller('operations/loans')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class LoansOperationsController {
  constructor(
    private readonly delinquency: LoanDelinquencyService,
    private readonly outcomes: OutcomeDispatchService,
    private readonly loansQuery: LoanQueryService,
  ) {}

  @Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Recalcular mora y encolar los desenlaces de cosecha ya cumplidos',
    description:
      'Recorre la cartera viva, actualiza días de atraso y tramo, y encola una observación por cada ventana ' +
      '(30, 90 y 180 días desde la decisión) que ya venció y todavía no se había observado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(loanSweepSchema) })
  @ApiResponse({ status: 200, description: 'Préstamos evaluados y observaciones encoladas.' })
  @Post('delinquency-sweep')
  @HttpCode(HttpStatus.OK)
  sweep(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(loanSweepSchema)) body: LoanSweepDto) {
    // Siempre acotado al tenant de la sesión. Barrer la cartera de TODOS los tenants desde una
    // consola de operaciones era una operación de plataforma escondida tras una casilla.
    return this.delinquency.sweep({ tenantId, limit: body.limit });
  }

  /*
   * `POST outcome-dispatch` ya no vive aquí. Entregar desenlaces al Motor es integración, no una
   * decisión de operaciones: lo hace el job `dispatch_loan_outcomes` y, a mano, `POST
   * /runtime-jobs/dispatch-loan-outcomes`. Lo que sí sigue siendo de esta pantalla es SABER si la
   * entrega va al día (`outcome-backlog`).
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Cartera de préstamos para el personal',
    description:
      'Préstamos del tenant por estado, tramo de mora, cliente, solicitud o código, paginados. Sin esto el portal sólo ' +
      'podía abrir un préstamo por número o desde la ficha del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Préstamos con su comercio, paginados.' })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listLoansQuerySchema)) query: ListLoansQueryDto) {
    return this.loansQuery.listForStaff(tenantId, query);
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Estado de la entrega de desenlaces al Motor',
    description:
      'Cuántos desenlaces esperan, cuántos reintentan, cuántos agotaron y cuántos llegaron; desde cuándo espera el más ' +
      'antiguo y cuándo fue la última entrega. La entrega la hace el job dispatch_loan_outcomes; la medida está en el Motor.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Resumen de la cola de desenlaces.' })
  @Get('outcome-status')
  outcomeStatus(@CurrentTenant() tenantId: string) {
    return this.outcomes.summarize(tenantId);
  }

  @Roles('risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Desenlaces que agotaron los reintentos',
    description:
      'Un desenlace que nunca llegó al motor es un agujero en la medida del modelo. Se listan para que ' +
      'quien recalibra sepa que su muestra está incompleta antes de sacar conclusiones de ella.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Observaciones sin entregar.' })
  @Get('outcome-backlog')
  backlog(@CurrentTenant() tenantId: string, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '100', 10);
    const safeLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
    return this.outcomes.listExhausted(tenantId, safeLimit);
  }
}
