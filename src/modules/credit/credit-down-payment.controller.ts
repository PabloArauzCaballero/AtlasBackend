/**
 * @file Adaptador HTTP: el pago inicial de una compra, avisado por el cliente y confirmado por el comercio.
 * @business El 60 % se paga directo al comercio al comprar: el cliente avisa con su comprobante y sólo el comercio lo confirma.
 * @system expone el aviso del cliente y, al comercio dueño de la compra, la lista, el comprobante y su decisión.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CreditDownPaymentService } from './application/credit-down-payment.service.js';
import {
  type CreditApplicationParamsDto,
  creditApplicationParamsSchema,
  type DecideDownPaymentDto,
  decideDownPaymentSchema,
  type MerchantApplicationsQueryDto,
  type MerchantPartnerApplicationParamsDto,
  type MerchantPartnerParamsDto,
  merchantApplicationsQuerySchema,
  merchantPartnerApplicationParamsSchema,
  merchantPartnerParamsSchema,
  type SubmitDownPaymentDto,
  submitDownPaymentSchema,
} from './credit.schemas.js';

/**
 * El lado del CLIENTE: avisar que pagó el inicial.
 *
 * Es el mismo comprobante que el de una cuota (se sube con el ticket de `payment-claims/proof-tickets`), pero el
 * préstamo todavía no existe, así que el aviso cuelga de la SOLICITUD. Sólo se acepta cuando el comercio ya
 * aceptó la venta, y no da nada por pagado: lo confirma quien recibe el dinero.
 */
@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId/credit-applications/:applicationId/down-payment')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditDownPaymentCustomerController {
  constructor(private readonly service: CreditDownPaymentService) {}

  @Roles('customer', 'internal_operator', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Avisar que se pagó el inicial de una compra' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Aviso registrado, esperando la confirmación del comercio.' })
  @ApiResponse({ status: 404, description: 'CREDIT_APPLICATION_NOT_FOUND.' })
  @ApiResponse({
    status: 409,
    description:
      'DOWN_PAYMENT_NOT_ALLOWED_YET, DOWN_PAYMENT_ALREADY_PENDING, DOWN_PAYMENT_ALREADY_CONFIRMED o IDEMPOTENCY_CONFLICT ' +
      '(la misma `x-idempotency-key` con otro cuerpo; con el mismo cuerpo se devuelve la respuesta original).',
  })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiResponse({
    status: 422,
    description:
      'EVIDENCE_OBJECT_NOT_FOUND, APPLICATION_WITHOUT_PARTNER o DOWN_PAYMENT_AMOUNT_MISMATCH (el importe no es el inicial ' +
      'de la compra; `error.details.expectedAmount` dice cuál es).',
  })
  @Post()
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentTenant() tenantId: string,
    @Param('customerId') customerId: string,
    @Param(new ZodValidationPipe(creditApplicationParamsSchema.pick({ applicationId: true })))
    params: Pick<CreditApplicationParamsDto, 'applicationId'>,
    @Body(new ZodValidationPipe(submitDownPaymentSchema)) body: SubmitDownPaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.submit({ tenantId, customerId, applicationId: params.applicationId, body, currentUser });
  }
}

/**
 * El lado del COMERCIO: ver los pagos iniciales que le avisaron, mirar el comprobante y confirmar o rechazar.
 *
 * Va aparte de `MerchantCreditController` por tamaño y por lo mismo que aquél va aparte del de operaciones: la
 * propiedad se comprueba dentro del servicio contra el dueño del expediente, no con un guard.
 */
@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('merchant/partners/:partnerId/down-payments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('merchant', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class MerchantDownPaymentController {
  constructor(private readonly service: CreditDownPaymentService) {}

  @ApiOperation({ summary: 'Pagos iniciales de mis compras, por defecto sólo los que esperan mi confirmación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Pagos iniciales avisados por los clientes, más recientes primero.' })
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(merchantPartnerParamsSchema)) params: MerchantPartnerParamsDto,
    @Query(new ZodValidationPipe(merchantApplicationsQuerySchema)) query: MerchantApplicationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listForPartner({ tenantId, partnerProfileId: params.partnerId, onlyPending: query.onlyPending, currentUser });
  }

  /** La imagen del comprobante, para MIRARLA antes de confirmar: confirmar es dar por recibido dinero real. */
  @ApiOperation({ summary: 'La imagen del comprobante del pago inicial' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'La imagen del comprobante.' })
  @ApiResponse({ status: 404, description: 'CREDIT_APPLICATION_NOT_FOUND | DOWN_PAYMENT_WITHOUT_PROOF.' })
  @Get(':applicationId/proof')
  @Header('Cache-Control', 'private, max-age=60')
  async proof(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(merchantPartnerApplicationParamsSchema)) params: MerchantPartnerApplicationParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const imagen = await this.service.readProof({
      tenantId,
      partnerProfileId: params.partnerId,
      applicationId: params.applicationId,
      currentUser,
    });
    response.setHeader('Content-Type', imagen.contentType);
    return new StreamableFile(imagen.bytes);
  }

  @ApiOperation({ summary: 'Confirmar o rechazar el pago inicial de una compra' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Decisión registrada; el cliente la ve en su app.' })
  @ApiResponse({ status: 403, description: 'La compra no nació en este comercio.' })
  @ApiResponse({ status: 409, description: 'DOWN_PAYMENT_NOT_PENDING.' })
  @ApiResponse({ status: 422, description: 'DOWN_PAYMENT_AMOUNT_MISMATCH: el importe avisado no es el inicial de la compra.' })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @Post(':applicationId/verification')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(merchantPartnerApplicationParamsSchema)) params: MerchantPartnerApplicationParamsDto,
    @Body(new ZodValidationPipe(decideDownPaymentSchema)) body: DecideDownPaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.decide({ tenantId, partnerProfileId: params.partnerId, applicationId: params.applicationId, body, currentUser });
  }
}
