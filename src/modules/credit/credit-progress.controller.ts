/**
 * @file Controlador HTTP: expone el nivel del cliente por rutas versionadas.
 * @business La app muestra el nivel Atlas, la barra de experiencia y las misiones para subir; esta ruta es lo que las alimenta.
 * @system valida la propiedad del recurso y delega en `CreditProgressService`.
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../common/utils/auth/ownership.util.js';
import { CreditProgressService } from './application/credit-progress.service.js';
import { CreditCustomerIdParamsDto, creditCustomerIdParamsSchema } from './credit.schemas.js';

@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditProgressController {
  constructor(private readonly progress: CreditProgressService) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Nivel del cliente y su evolución',
    description:
      'El nivel Atlas (de «Nuevo» a «Preferente»), la puntuación de relación 0-100, los puntos que faltan para el ' +
      'siguiente nivel, cómo se reparte la puntuación, las misiones para subir y la evolución de la línea. Se calcula ' +
      'con datos de la base —antigüedad, pagos, compras cerradas, identidad—, NO con el motor, así que existe aunque ' +
      'la línea de crédito todavía no se haya calculado. Ninguna misión premia endeudarse.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiResponse({ status: 200, description: 'Nivel, puntos, componentes, misiones, señales e historial.' })
  @Get('progress')
  progressOf(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return this.progress.get(tenantId, params.customerId);
  }
}
