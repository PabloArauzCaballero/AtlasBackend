/**
 * @file Controlador HTTP: la tarjeta de un cliente para el personal (ver, ajustar a mano y revocar).
 * @business Permite que una persona del personal ponga a un cliente una tarjeta distinta de la que ganó, siempre con motivo y quedando en el historial, sin que eso cambie su límite de crédito.
 * @system valida la entrada con Zod, comprueba el rol y delega en `CardTierService`; la tarjeta ganada se calcula con `CreditProgressService`.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorOf, CardTierService } from './application/card-tier.service.js';
import { CreditProgressService } from './application/credit-progress.service.js';
import { toOperationsCardResponse } from './card-tier.mapper.js';
import {
  revokeCardTierOverrideSchema,
  setCardTierOverrideSchema,
  type RevokeCardTierOverrideDto,
  type SetCardTierOverrideDto,
} from './card-tier.schemas.js';
import { CreditCustomerIdParamsDto, creditCustomerIdParamsSchema } from './credit.schemas.js';

@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('operations/customers/:customerId/card-tier')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
// Los mismos cuatro roles que ven y operan el crédito de un cliente en el portal: la tarjeta es presentación y estatus,
// no riesgo, así que no hay motivo para dejar fuera a quien ya revisa el crédito de esa persona.
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class CardTierOperationsController {
  constructor(
    private readonly cards: CardTierService,
    private readonly progress: CreditProgressService,
  ) {}

  private async view(tenantId: string, customerId: string) {
    // La tarjeta automática sigue al nivel por PUNTOS, igual que la que ve el cliente en `/progress`.
    const { level } = await this.progress.levelOf(tenantId, customerId);
    const [card, catalog, history] = await Promise.all([
      this.cards.resolveFor(tenantId, customerId, level.code),
      this.cards.catalog(tenantId),
      this.cards.history(tenantId, customerId),
    ]);
    return toOperationsCardResponse(card, catalog, history);
  }

  @ApiOperation({
    summary: 'Tarjeta de un cliente',
    description:
      'La tarjeta vigente (la que ganó por su nivel o la que el personal le puso), de dónde viene, el escalón completo ' +
      'y el historial de ajustes manuales con motivo, autor y revocaciones.',
  })
  @ApiResponse({ status: 200, description: 'Tarjeta, catálogo e historial.' })
  @Get()
  get(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto) {
    return this.view(tenantId, params.customerId);
  }

  @ApiOperation({
    summary: 'Poner una tarjeta a mano',
    description:
      'Ajusta la tarjeta del cliente con un motivo obligatorio (mínimo 10 caracteres) y, si se quiere, un vencimiento. ' +
      'Reemplaza el ajuste anterior. NO cambia el límite de crédito: la tarjeta es presentación y estatus. Queda en la ' +
      'auditoría operativa. Al vencer o revocarse, el cliente vuelve a la tarjeta que le corresponde por su nivel.',
  })
  @ApiBody({ schema: zodToApiSchema(setCardTierOverrideSchema) })
  @ApiResponse({ status: 201, description: 'Ajuste creado; devuelve la tarjeta resultante.' })
  @ApiResponse({ status: 400, description: 'Motivo corto, tarjeta inexistente o vencimiento pasado.' })
  @Post()
  async set(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @Body(new ZodValidationPipe(setCardTierOverrideSchema)) body: SetCardTierOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cards.setOverride({
      tenantId,
      customerId: params.customerId,
      tierCode: body.tierCode,
      reason: body.reason,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      actor: actorOf(user),
    });
    return this.view(tenantId, params.customerId);
  }

  @ApiOperation({
    summary: 'Revocar el ajuste manual',
    description: 'Quita el ajuste vigente, con motivo obligatorio. El cliente vuelve a la tarjeta que le corresponde por su nivel.',
  })
  @ApiBody({ schema: zodToApiSchema(revokeCardTierOverrideSchema) })
  @ApiResponse({ status: 200, description: 'Ajuste revocado; devuelve la tarjeta resultante.' })
  @ApiResponse({ status: 404, description: 'El cliente no tiene un ajuste manual que revocar.' })
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @Body(new ZodValidationPipe(revokeCardTierOverrideSchema)) body: RevokeCardTierOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cards.revokeOverride({ tenantId, customerId: params.customerId, reason: body.reason, actor: actorOf(user) });
    return this.view(tenantId, params.customerId);
  }
}
