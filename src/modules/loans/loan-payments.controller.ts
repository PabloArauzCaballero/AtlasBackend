/**
 * @file Lo que MUEVE dinero sobre un préstamo: registrar un pago, revertirlo y castigar la deuda.
 * @business Esta pieza sostiene la operación diaria del backend.
 * @system implementa este tramo del módulo.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';

import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { LoanDisbursementService } from './application/loan-disbursement.service.js';
import { LoanPaymentService } from './application/loan-payment.service.js';
import { LoanQueryService } from './application/loan-query.service.js';
import { LoanSpendingService } from './application/loan-spending.service.js';
import { LoanCalendarService } from './application/loan-calendar.service.js';
import { DelinquencyPolicyService } from './application/delinquency-policy.service.js';
import { SpendingReportService } from './application/spending-report.service.js';
import { LoanWriteOffService } from './application/loan-writeoff.service.js';
import {
  LoanIdParamsDto,
  LoanPaymentParamsDto,
  RegisterPaymentDto,
  ReversePaymentDto,
  WriteOffLoanDto,
  loanIdParamsSchema,
  loanPaymentParamsSchema,
  registerPaymentSchema,
  reversePaymentSchema,
  writeOffLoanSchema,
} from './loans.schemas.js';

/**
 * El libro de préstamos: lo que ocurre después de aprobar.
 *
 * Desembolsar, castigar y reversar mueven dinero o lo dan por perdido, así que ninguno de los tres
 * lo puede hacer el propio cliente: son operaciones internas con actor identificado y motivo. Leer
 * la ficha sí lo puede hacer el cliente, sobre su propio préstamo.
 */

/**
 * Salen de `LoansController` porque son las tres rutas que ESCRIBEN sobre el saldo, frente al
 * resto del archivo, que consulta. Además dejaban el controlador por encima de las 300 líneas de
 * `check:file-size`.
 */
@ApiTags('loans')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class LoanPaymentsController {
  constructor(
    private readonly disbursement: LoanDisbursementService,
    private readonly payments: LoanPaymentService,
    private readonly writeOff: LoanWriteOffService,
    private readonly queries: LoanQueryService,
    private readonly spending: LoanSpendingService,
    private readonly calendar: LoanCalendarService,
    private readonly policies: DelinquencyPolicyService,
    private readonly report: SpendingReportService,
  ) {}

  @Roles('internal_operator', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Registrar un cobro',
    description:
      'Aplica el cobro con prelación mora → interés → capital, sobre la cuota más antigua primero. ' +
      'Un importe mayor que lo pendiente se rechaza: adelantar cuotas es una decisión de producto.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(registerPaymentSchema) })
  @ApiResponse({ status: 201, description: 'Cobro aplicado.' })
  @ApiResponse({ status: 422, description: 'PAYMENT_EXCEEDS_OUTSTANDING o CURRENCY_MISMATCH.' })
  @Post('loans/:loanId/payments')
  @HttpCode(HttpStatus.CREATED)
  registerPayment(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(loanIdParamsSchema)) params: LoanIdParamsDto,
    @Body(new ZodValidationPipe(registerPaymentSchema)) body: RegisterPaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.payments.registerPayment({
      tenantId,
      loanId: params.loanId,
      body,
      currentUser,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('internal_operator', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Reversar un cobro ya aplicado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(reversePaymentSchema) })
  @ApiResponse({ status: 200, description: 'Cobro reversado.' })
  @ApiResponse({ status: 409, description: 'LOAN_PAYMENT_ALREADY_REVERSED.' })
  @Post('loans/:loanId/payments/:paymentId/reversal')
  @HttpCode(HttpStatus.OK)
  reversePayment(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(loanPaymentParamsSchema)) params: LoanPaymentParamsDto,
    @Body(new ZodValidationPipe(reversePaymentSchema)) body: ReversePaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.payments.reversePayment({
      tenantId,
      loanId: params.loanId,
      paymentId: params.paymentId,
      body,
      currentUser,
    });
  }

  @Roles('admin', 'platform_admin')
  @ApiOperation({
    summary: 'Castigar un préstamo incobrable',
    description:
      'Reconoce la pérdida sin borrar el préstamo: el importe castigado queda escrito porque es dato ' +
      'de riesgo de primer orden y alimenta el desenlace que recibe el motor.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(writeOffLoanSchema) })
  @ApiResponse({ status: 200, description: 'Préstamo castigado.' })
  @ApiResponse({ status: 409, description: 'LOAN_ALREADY_WRITTEN_OFF o LOAN_NOT_WRITE_OFF_ELIGIBLE.' })
  @Post('loans/:loanId/write-off')
  @HttpCode(HttpStatus.OK)
  writeOffLoan(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(loanIdParamsSchema)) params: LoanIdParamsDto,
    @Body(new ZodValidationPipe(writeOffLoanSchema)) body: WriteOffLoanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.writeOff.writeOff({
      tenantId,
      loanId: params.loanId,
      body,
      currentUser,
    });
  }
}
