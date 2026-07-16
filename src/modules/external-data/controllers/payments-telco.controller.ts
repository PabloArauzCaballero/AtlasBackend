import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../../common/utils/http/headers.util.js';
import { actorId, assertCustomerAccess } from '../external-data-controller.util.js';
import { ExternalDataService } from '../external-data.service.js';
import {
  bankTransferVerifySchema,
  BankTransferVerifyDto,
  customerIdParamsSchema,
  CustomerIdParamsDto,
  qrPaymentVerifySchema,
  QrPaymentVerifyDto,
  telcoPhoneTrustSchema,
  TelcoPhoneTrustDto,
} from '../external-data.schemas.js';

/**
 * Verticales de pagos (QR / transferencia bancaria) y telco (confianza del número).
 *
 * Extraídos de `external-data.controller.ts` (Fase 2.2 del plan 10/10) sin cambios: rutas, guards,
 * roles y comportamiento idénticos.
 */

@ApiTags('payments-external')
@ApiBearerAuth('access-token')
@Controller('payments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class PaymentsExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Verificar pago por QR',
    description: 'Valida un pago realizado por QR contra el proveedor genérico configurado (QR_GENERIC / QR_BCB_GENERIC).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(qrPaymentVerifySchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la verificación del pago QR.' })
  @Post('qr/verify')
  @HttpCode(HttpStatus.OK)
  verifyQr(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(qrPaymentVerifySchema)) body: QrPaymentVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeQrPayment({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({
    summary: 'Verificar transferencia bancaria',
    description: 'Valida una transferencia bancaria declarada contra el proveedor bancario genérico configurado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(bankTransferVerifySchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la verificación de transferencia.' })
  @Post('bank-transfer/verify')
  @HttpCode(HttpStatus.OK)
  verifyBankTransfer(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(bankTransferVerifySchema)) body: BankTransferVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeBankTransfer({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}

@ApiTags('telco')
@ApiBearerAuth('access-token')
@Controller('telco')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class TelcoExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @ApiOperation({
    summary: 'Verificar confianza de teléfono (telco)',
    description:
      'Consulta al proveedor telco genérico señales de confianza del número (antigüedad de línea, SIM swap reciente, portabilidad).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: false })
  @ApiBody({ schema: zodToApiSchema(telcoPhoneTrustSchema) })
  @ApiResponse({ status: 200, description: 'Resultado de la verificación de confianza telefónica.' })
  @Post('phone-trust/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhoneTrust(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(telcoPhoneTrustSchema)) body: TelcoPhoneTrustDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeTelcoPhoneTrust({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @ApiOperation({ summary: 'Features de confianza telefónica de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Features de confianza telefónica.' })
  @Get('phone-trust/:customerId')
  getPhoneTrust(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}
