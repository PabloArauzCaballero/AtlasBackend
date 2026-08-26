/**
 * @file Adaptador HTTP: el comercio revisa los comprobantes que le llegaron y los confirma.
 * @business Sólo el comercio ve el dinero entrar en su cuenta, así que sólo él puede dar por pagada la cuota.
 * @system lista lo pendiente de SU expediente y registra el pago al verificar.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import {
  type ClaimsQueryDto,
  claimsQuerySchema,
  type DecidePaymentClaimDto,
  decidePaymentClaimSchema,
} from './loan-payment-claims.schemas.js';
import { LoanPaymentClaimsService } from './loan-payment-claims.service.js';

/**
 * Los comprobantes que esperan la palabra del comercio.
 *
 * Va en su propio controlador y no ampliando los roles del de operaciones, por lo mismo que la
 * aceptación de crédito: aquel declara `@Roles` a nivel de clase y añadir `merchant` allí abriría
 * de una vez todos sus endpoints.
 *
 * La propiedad se comprueba dentro del servicio contra el dueño del expediente. No basta con ser
 * `merchant`: hay que ser el de ESTE comercio, y el comprobante tiene que haber llegado a él.
 */
@ApiTags('Merchant · Cobros')
@ApiBearerAuth('access-token')
@Controller('merchant/partners/:partnerId/payment-claims')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('merchant', 'internal_operator', 'admin', 'platform_admin')
export class MerchantPaymentClaimsController {
  constructor(private readonly service: LoanPaymentClaimsService) {}

  @ApiOperation({ summary: 'Comprobantes que esperan mi confirmación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Reclamos del comercio, más recientes primero.' })
  @Get()
  list(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('partnerId') partnerId: string,
    @Query(new ZodValidationPipe(claimsQuerySchema)) query: ClaimsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listForPartner({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      partnerProfileId: partnerId,
      onlyPending: query.onlyPending,
      currentUser,
    });
  }

  @ApiOperation({ summary: 'Mi cartera: qué me deben, quién y cuándo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Resumen, créditos con su detalle y calendario de cobros.' })
  @Get('portfolio')
  portfolio(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('partnerId') partnerId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.portfolioForPartner({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      partnerProfileId: partnerId,
      currentUser,
    });
  }

  /**
   * La imagen del comprobante, para poder MIRARLA antes de decidir.
   *
   * La cola enseñaba el importe declarado y la referencia del banco, pero no el papel: el comercio
   * confirmaba o rechazaba sin ver nada. Y confirmar no es un gesto de trámite — registra un pago
   * real contra el préstamo.
   */
  @ApiOperation({ summary: 'La imagen del comprobante que subió el cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'La imagen del comprobante.' })
  @ApiResponse({ status: 404, description: 'PAYMENT_CLAIM_NOT_FOUND | PAYMENT_CLAIM_WITHOUT_PROOF.' })
  @Get(':claimId/proof')
  @Header('Cache-Control', 'private, max-age=60')
  async proof(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('partnerId') partnerId: string,
    @Param('claimId') claimId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const imagen = await this.service.readProof({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      partnerProfileId: partnerId,
      claimId,
      currentUser,
    });
    response.setHeader('Content-Type', imagen.contentType);
    return new StreamableFile(imagen.bytes);
  }

  @ApiOperation({ summary: 'Confirmar o rechazar un comprobante' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Al confirmar queda registrado el pago del préstamo.' })
  @ApiResponse({ status: 409, description: 'PAYMENT_CLAIM_NOT_PENDING.' })
  @Post(':claimId/verification')
  @HttpCode(HttpStatus.OK)
  decide(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('partnerId') partnerId: string,
    @Param('claimId') claimId: string,
    @Body(new ZodValidationPipe(decidePaymentClaimSchema)) body: DecidePaymentClaimDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.decide({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      partnerProfileId: partnerId,
      claimId,
      body,
      currentUser,
    });
  }
}
