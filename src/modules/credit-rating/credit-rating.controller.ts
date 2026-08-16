/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system expone la calificación vigente y su historial para deuda y cliente.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RatingQueryService } from './application/rating-query.service.js';
import {
  RatingCustomerParamsDto,
  RatingHistoryQueryDto,
  RatingLoanParamsDto,
  ratingCustomerParamsSchema,
  ratingHistoryQuerySchema,
  ratingLoanParamsSchema,
} from './credit-rating.schemas.js';

/**
 * Lectura de calificaciones.
 *
 * Todos los endpoints son de roles INTERNOS. La calificación de un cliente es un juicio sobre él con
 * consecuencia económica, y exponérsela por la misma API con la que consulta su saldo abre dos
 * problemas distintos: enseña el umbral exacto a quien tiene incentivo para quedar justo por encima,
 * y convierte cualquier recálculo en una notificación implícita de que se le bajó la nota. Si el
 * producto decide mostrársela, será por un endpoint propio con su texto y su momento — no por este.
 */
@ApiTags('credit-rating')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditRatingController {
  constructor(private readonly queries: RatingQueryService) {}

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Escala de calificación vigente',
    description:
      'Categorías de la política activa con su etiqueta, tramo de mora, tasa de previsión, orden de severidad y una explicación lista para mostrar. ' +
      'La interfaz debe leer de aquí en vez de fijar la escala: es versionada y regulatoria, y una copia se separa al aprobarse una versión nueva.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Escala vigente con sus categorías explicadas.' })
  @ApiResponse({ status: 422, description: 'No hay política de calificación activa.' })
  @Get('operations/rating-scale')
  getRatingScale(@CurrentTenant() tenantId: string) {
    return this.queries.getRatingScale(tenantId);
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Calificación vigente de una deuda',
    description:
      'Categoría de riesgo del crédito, con días de atraso, exposición, tasa de previsión y el importe previsionado. ' +
      'Incluye la versión de política con la que se calculó: sin ella la cifra no es reproducible.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'loanId', schema: zodToApiSchema(ratingLoanParamsSchema.shape.loanId) })
  @ApiResponse({ status: 200, description: 'Calificación vigente del crédito.' })
  @ApiResponse({ status: 404, description: 'El crédito no tiene calificación vigente.' })
  @Get('operations/loans/:loanId/rating')
  getLoanRating(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(ratingLoanParamsSchema)) params: RatingLoanParamsDto) {
    return this.queries.getLoanRating(tenantId, params.loanId);
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Historial de calificaciones de una deuda',
    description: 'Cada recalificación con su categoría anterior. Es la curva de deterioro del crédito, no su foto actual.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'loanId', schema: zodToApiSchema(ratingLoanParamsSchema.shape.loanId) })
  @ApiResponse({ status: 200, description: 'Historial de calificaciones del crédito.' })
  @Get('operations/loans/:loanId/rating-history')
  getLoanRatingHistory(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(ratingLoanParamsSchema)) params: RatingLoanParamsDto,
    @Query(new ZodValidationPipe(ratingHistoryQuerySchema)) query: RatingHistoryQueryDto,
  ) {
    return this.queries.getLoanRatingHistory(tenantId, params.loanId, query.limit);
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Calificación vigente de un cliente',
    description:
      'Categoría del cliente por arrastre de sus operaciones, con exposición y previsión totales y el crédito que fijó ' +
      'la categoría (`drivingLoanId`) — la respuesta a por qué está donde está.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(ratingCustomerParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Calificación vigente del cliente.' })
  @ApiResponse({ status: 404, description: 'El cliente no tiene calificación vigente.' })
  @Get('operations/customers/:customerId/credit-rating')
  getCustomerRating(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(ratingCustomerParamsSchema)) params: RatingCustomerParamsDto,
  ) {
    return this.queries.getCustomerRating(tenantId, params.customerId);
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Historial de calificaciones de un cliente',
    description: 'Cómo migró de categoría a lo largo del tiempo, con la política vigente en cada corte.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(ratingCustomerParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Historial de calificaciones del cliente.' })
  @Get('operations/customers/:customerId/credit-rating-history')
  getCustomerRatingHistory(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(ratingCustomerParamsSchema)) params: RatingCustomerParamsDto,
    @Query(new ZodValidationPipe(ratingHistoryQuerySchema)) query: RatingHistoryQueryDto,
  ) {
    return this.queries.getCustomerRatingHistory(tenantId, params.customerId, query.limit);
  }
}
