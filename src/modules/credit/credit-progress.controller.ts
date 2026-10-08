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
      'El nivel Atlas (de «Nuevo» a «Preferente»), la puntuación de relación 0-100 y POR QUÉ se le asigna a esta persona ' +
      '(cada parte con su peso, los puntos que aporta y la razón, más los topes que de verdad la recortaron), los puntos ' +
      'que faltan para el siguiente nivel, las misiones para subir, la experiencia (1 punto por cada boliviano comprado ' +
      'con Atlas, rachas e insignias de pago) y la evolución de la línea. Se calcula con datos de la base —antigüedad, pagos, compras ' +
      'cerradas, identidad—, NO con el motor, así que existe aunque la línea de crédito todavía no se haya calculado. ' +
      'La experiencia da el nivel; la calificación 1-100 mide qué tan buen pagador es la persona.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiResponse({
    status: 200,
    description:
      'Nivel, componentes, misiones, señales e historial. `rating` = Calificación de pagador de 1 a 100; `points` = Puntaje de experiencia: 1 por cada Bs 10 comprados (tope 100 por compra), 50 por cuota a tiempo, 25 más si se pagó con 3 días de adelanto y 200 por compra terminada; su desglose en `experience.xpBreakdown`. Ninguno de los dos es el score 0-1000 del motor. `level`/`nextLevel`/`levelLadder` = Nivel Atlas medido en PUNTOS: doce niveles (Nuevo 0 · Explorador 100 · En crecimiento 500 · Constante 1.000 · Establecido 2.000 · Confiable 3.500 · Consolidado 5.000 · Destacado 7.500 · Preferente 10.000 · Élite 15.000 · Leyenda 25.000 · Titán Atlas 50.000); `code` es el escalón de cinco que sigue la tarjeta e `id` es único por nivel. `experience.badges` trae las insignias con `rank`, `category` y `secret`. `tier` sigue siendo el escalón de la relación que usa la capacidad de pago.',
  })
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
