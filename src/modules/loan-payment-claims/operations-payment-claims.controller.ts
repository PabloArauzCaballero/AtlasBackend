/**
 * @file Adaptador HTTP: la cola de avisos de pago de todo el tenant, para operaciones.
 * @business Operaciones supervisa que los comercios verifiquen a tiempo; no verifica por ellos.
 * @system expone una lista paginada y filtrable, sólo de lectura, con roles internos.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { type OperationsClaimsQueryDto, operationsClaimsQuerySchema } from './loan-payment-claims.schemas.js';
import { OperationsPaymentClaimsService } from './operations-payment-claims.service.js';

const propiedades = zodObjectPropertySchemas(operationsClaimsQuerySchema);

/**
 * Controlador propio y no una ruta más en el del comercio: aquel se abre por `:partnerId` y
 * comprueba propiedad del expediente; éste es transversal a todos los comercios y sólo para
 * personal interno, con los mismos roles de lectura que el estado de la cartera
 * (`GET /operations/loans/outcome-status`).
 */
@ApiTags('loans-operations')
@ApiBearerAuth('access-token')
@Controller('operations/payment-claims')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class OperationsPaymentClaimsController {
  constructor(private readonly service: OperationsPaymentClaimsService) {}

  @ApiOperation({
    summary: 'Avisos de pago del tenant, para supervisar su verificación',
    description:
      'Lista paginada de los avisos de pago (pending_verification, verified, rejected) con su comercio, cliente, préstamo y ' +
      'cuota, y las horas que llevan esperando. Los pendientes salen primero, el más antiguo arriba; `stale` marca los que ' +
      'superan 48 h. Sólo lectura: la verificación la hace el comercio desde el ERP.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: propiedades.status })
  @ApiQuery({ name: 'partnerId', required: false, schema: propiedades.partnerId })
  @ApiQuery({ name: 'customerId', required: false, schema: propiedades.customerId })
  @ApiQuery({ name: 'olderThanHours', required: false, schema: propiedades.olderThanHours })
  @ApiQuery({ name: 'page', required: false, schema: propiedades.page })
  @ApiQuery({ name: 'pageSize', required: false, schema: propiedades.pageSize })
  @ApiResponse({ status: 200, description: 'Página de avisos, metadatos de paginación y resumen de la cola.' })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(operationsClaimsQuerySchema)) query: OperationsClaimsQueryDto) {
    return this.service.list(tenantId, query);
  }
}
