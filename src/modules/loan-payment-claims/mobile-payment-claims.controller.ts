/**
 * @file Adaptador HTTP: el cliente avisa desde la app que pagó por transferencia.
 * @business Sube su comprobante y queda esperando que el comercio lo confirme.
 * @system dos pasos: ticket de subida y aviso con la referencia del banco.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
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
  type PaymentProofTicketDto,
  paymentProofTicketSchema,
  type SubmitPaymentClaimDto,
  submitPaymentClaimSchema,
} from './loan-payment-claims.schemas.js';
import { LoanPaymentClaimsService } from './loan-payment-claims.service.js';

/**
 * El aviso de pago, desde el teléfono.
 *
 * La app ya enseña el QR bancario del comercio y ya dice la verdad: el comprobante es evidencia, no
 * confirma el pago por sí solo. Lo que faltaba es que ese comprobante llegara a alguien — hasta
 * ahora se quedaba en el teléfono, el cliente creía haber avisado y el comercio nunca se enteraba.
 */
@ApiTags('Mobile · Pagos')
@ApiBearerAuth('access-token')
@Controller('mobile/customers/:customerId/payment-claims')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'admin', 'platform_admin')
export class MobilePaymentClaimsController {
  constructor(private readonly service: LoanPaymentClaimsService) {}

  /**
   * Dónde pagar esta cuota: el QR bancario REAL del comercio, con su beneficiario y el importe.
   *
   * Va antes que el ticket de subida porque es lo primero que ocurre: primero se paga, y sólo
   * después se avisa. La pantalla decía «se paga al QR bancario del comercio» y no enseñaba
   * ninguno —no existía ruta que lo devolviera—, así que la instrucción no se podía seguir.
   */
  @ApiOperation({ summary: 'Cómo pagar esta cuota: el QR bancario del comercio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Importe, beneficiario y el QR del comercio embebido.' })
  @ApiResponse({ status: 404, description: 'INSTALLMENT_NOT_FOUND.' })
  @Get('instructions/:installmentId')
  instruction(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('customerId') customerId: string,
    @Param('installmentId') installmentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.paymentInstruction({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId,
      installmentId,
      currentUser,
    });
  }

  @ApiOperation({ summary: 'Permiso para subir el comprobante' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'URL firmada y clave del objeto.' })
  @Post('proof-tickets')
  createTicket(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(paymentProofTicketSchema)) body: PaymentProofTicketDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.createProofTicket({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId,
      body,
      currentUser,
    });
  }

  @ApiOperation({ summary: 'Avisar que se pagó una cuota por transferencia' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Reclamo creado, esperando verificación del comercio.' })
  @ApiResponse({ status: 409, description: 'PAYMENT_CLAIM_ALREADY_PENDING o INSTALLMENT_ALREADY_PAID.' })
  @Post()
  @HttpCode(HttpStatus.OK)
  submit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(submitPaymentClaimSchema)) body: SubmitPaymentClaimDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.submit({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      customerId,
      body,
      currentUser,
    });
  }
}
