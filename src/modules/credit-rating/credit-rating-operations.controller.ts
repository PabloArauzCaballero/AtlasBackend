/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system dispara recalificaciones y expone la distribución de la cartera por categoría.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DebtRatingService } from './application/debt-rating.service.js';
import { RatingQueryService } from './application/rating-query.service.js';
import { toCustomerRatingResponse, toLoanRatingResponse } from './credit-rating.mapper.js';
import {
  RatingCustomerParamsDto,
  RatingLoanParamsDto,
  RatingSweepDto,
  ratingCustomerParamsSchema,
  ratingLoanParamsSchema,
  ratingSweepSchema,
} from './credit-rating.schemas.js';

/**
 * Operación de la calificación: recalcular y mirar la cartera.
 *
 * El barrido se expone como endpoint —y no sólo como trabajo programado— porque riesgo necesita
 * poder forzarlo antes de un cierre o después de activar una política nueva, y porque así el runbook
 * es una llamada y no un acceso directo a la base.
 */
@ApiTags('credit-rating-operations')
@ApiBearerAuth('access-token')
@Controller('operations/credit-rating')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditRatingOperationsController {
  constructor(
    private readonly rating: DebtRatingService,
    private readonly queries: RatingQueryService,
  ) {}

  @Roles('risk_analyst', 'internal_operator', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Recalificar toda la cartera del tenant',
    description:
      'Recorre los clientes con deuda viva y recalifica cada operación y su ficha. Devuelve cuántos se calificaron y ' +
      'cuáles fallaron: un barrido que sólo dijera "ok" habiendo calificado la mitad sería peor que uno que falla.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(ratingSweepSchema) })
  @ApiResponse({ status: 200, description: 'Clientes recorridos, calificados y fallidos.' })
  @ApiResponse({ status: 422, description: 'RATING_POLICY_NOT_ACTIVE — no hay matriz vigente con la que calificar.' })
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  sweep(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(ratingSweepSchema)) body: RatingSweepDto) {
    return this.rating.sweep({ tenantId, limit: body.limit });
  }

  @Roles('risk_analyst', 'internal_operator', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Recalificar una deuda (y, con ella, a su titular)',
    description:
      'Calificar un crédito aislado no es posible sin dejar mentida la ficha del cliente: su categoría se deriva por ' +
      'arrastre de todas sus operaciones. Por eso esta llamada recalifica la cartera completa del titular en una sola ' +
      'transacción y devuelve ambas calificaciones.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'loanId', schema: zodToApiSchema(ratingLoanParamsSchema.shape.loanId) })
  @ApiResponse({ status: 200, description: 'Calificación del crédito y del cliente.' })
  @ApiResponse({ status: 404, description: 'LOAN_NOT_FOUND.' })
  @ApiResponse({ status: 422, description: 'LOAN_NOT_RATEABLE o RATING_POLICY_NOT_ACTIVE.' })
  @Post('loans/:loanId/rate')
  @HttpCode(HttpStatus.OK)
  async rateLoan(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(ratingLoanParamsSchema)) params: RatingLoanParamsDto) {
    const result = await this.rating.rateLoanById({ tenantId, loanId: params.loanId });
    return {
      loanRating: result.loanRating ? toLoanRatingResponse(result.loanRating) : null,
      customerRating: toCustomerRatingResponse(result.customerRating),
    };
  }

  @Roles('risk_analyst', 'internal_operator', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Recalificar a un cliente y todas sus deudas',
    description: 'Recalifica cada operación con exposición del cliente y vuelve a derivar su categoría por arrastre.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(ratingCustomerParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Calificaciones de sus deudas y la del cliente.' })
  @ApiResponse({ status: 422, description: 'RATING_POLICY_NOT_ACTIVE.' })
  @Post('customers/:customerId/rate')
  @HttpCode(HttpStatus.OK)
  async rateCustomer(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(ratingCustomerParamsSchema)) params: RatingCustomerParamsDto,
  ) {
    const result = await this.rating.rateCustomerById({ tenantId, customerId: params.customerId });
    return {
      loanRatings: result.loanRatings.map(toLoanRatingResponse),
      customerRating: toCustomerRatingResponse(result.customerRating),
    };
  }

  @Roles('risk_analyst', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Distribución de la cartera por categoría',
    description:
      'Cuántos créditos, cuánta exposición y cuánta previsión hay en cada categoría, con la política que produjo el ' +
      'corte. Sin esa política dos cortes no son comparables: un umbral distinto se lee como deterioro de la cartera.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Distribución por categoría y totales.' })
  @ApiResponse({ status: 422, description: 'RATING_POLICY_NOT_ACTIVE.' })
  @Get('portfolio-summary')
  getPortfolioSummary(@CurrentTenant() tenantId: string) {
    return this.queries.getPortfolioSummary(tenantId);
  }
}
