/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system expone el ciclo del préstamo a operaciones y cobranza con autorización explícita.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../common/utils/auth/ownership.util.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { LoanDisbursementService } from './application/loan-disbursement.service.js';
import { LoanPaymentService } from './application/loan-payment.service.js';
import { LoanQueryService } from './application/loan-query.service.js';
import { LoanSpendingService } from './application/loan-spending.service.js';
import { DelinquencyPolicyService } from './application/delinquency-policy.service.js';
import { SpendingReportService } from './application/spending-report.service.js';
import { LoanWriteOffService } from './application/loan-writeoff.service.js';
import {
  DisburseLoanDto,
  LoanApplicationParamsDto,
  LoanCustomerParamsDto,
  LoanIdParamsDto,
  LoanPaymentParamsDto,
  RegisterPaymentDto,
  ReversePaymentDto,
  WriteOffLoanDto,
  disburseLoanSchema,
  loanApplicationParamsSchema,
  loanCustomerParamsSchema,
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
@ApiTags('loans')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class LoansController {
  constructor(
    private readonly disbursement: LoanDisbursementService,
    private readonly payments: LoanPaymentService,
    private readonly writeOff: LoanWriteOffService,
    private readonly queries: LoanQueryService,
    private readonly spending: LoanSpendingService,
    private readonly policies: DelinquencyPolicyService,
    private readonly report: SpendingReportService,
  ) {}

  @Roles('internal_operator', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Desembolsar una solicitud aprobada',
    description:
      'Crea el préstamo y su cronograma en una sola transacción, heredando la referencia a la ejecución ' +
      'del motor que decidió la solicitud. Reintentar con la misma clave de idempotencia devuelve el ' +
      'préstamo ya creado en vez de duplicarlo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(disburseLoanSchema) })
  @ApiResponse({ status: 201, description: 'Préstamo desembolsado.' })
  @ApiResponse({ status: 409, description: 'CREDIT_APPLICATION_NOT_APPROVED o LOAN_ALREADY_DISBURSED.' })
  @Post('credit-applications/:applicationId/disbursement')
  @HttpCode(HttpStatus.CREATED)
  disburse(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(loanApplicationParamsSchema)) params: LoanApplicationParamsDto,
    @Body(new ZodValidationPipe(disburseLoanSchema)) body: DisburseLoanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.disbursement.disburse({
      tenantId,
      applicationId: params.applicationId,
      body,
      currentUser,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Préstamos del cliente, con el comercio donde nació cada uno' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Préstamos del cliente, más recientes primero.' })
  @Get('customers/:customerId/loans')
  listByCustomer(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(loanCustomerParamsSchema)) params: LoanCustomerParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    /*
     * La propiedad se comprobaba en el desembolso y en los cobros, pero NO aquí: el rol `customer`
     * bastaba para leer los préstamos de cualquier cliente del tenant cambiando el número de la
     * URL —su deuda, su mora y ahora también dónde compra—. El resto del dominio ya usa esta misma
     * comprobación; a este endpoint se le había pasado.
     */
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return this.queries.listByCustomer(tenantId, params.customerId);
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Gasto del cliente por rubro de comercio',
    description:
      'Sale del libro de préstamos y del expediente del comercio. Lo vencido y lo próximo se miden ' +
      'contra el CALENDARIO, no contra el contador de mora del préstamo, que lo actualiza un barrido.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Reparto por rubro, con el detalle por comercio.' })
  @Get('customers/:customerId/spending-by-category')
  spendingByCategory(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(loanCustomerParamsSchema)) params: LoanCustomerParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return this.spending.byCategory(tenantId, params.customerId);
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Informe de gastos por categoría en PDF',
    description: 'Lo compone el SERVIDOR con los mismos números de la pantalla, para que salga idéntico en cualquier dispositivo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'PDF del informe.' })
  @Get('customers/:customerId/spending-report.pdf')
  async spendingReport(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(loanCustomerParamsSchema)) params: LoanCustomerParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    const pdf = await this.report.pdf(tenantId, params.customerId, null);

    /*
     * `inline` y no `attachment`: la app lo abre en su visor y desde ahí el sistema ofrece guardar
     * o compartir. Forzar la descarga en un móvil deja el archivo en una carpeta que mucha gente no
     * sabe encontrar.
     */
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `inline; filename="atlas-gastos-${params.customerId}.pdf"`);
    response.setHeader('content-length', String(pdf.length));
    response.end(pdf);
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Política de mora e intereses vigente',
    description:
      'La versión vigente HOY, no la última publicada: una versión con entrada futura no se enseña antes ' +
      'de tiempo. Incluye el origen de cada regla —normativa o política de Atlas—.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Política vigente con sus tramos por días de atraso.' })
  @ApiResponse({ status: 404, description: 'DELINQUENCY_POLICY_NOT_PUBLISHED.' })
  @Get('policies/delinquency')
  delinquencyPolicy(@CurrentTenant() tenantId: string) {
    return this.policies.current(tenantId);
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Ficha del préstamo: cronograma, cobros e historial' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Préstamo con cronograma, cobros e historial.' })
  @ApiResponse({ status: 404, description: 'LOAN_NOT_FOUND.' })
  @Get('loans/:loanId')
  detail(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(loanIdParamsSchema)) params: LoanIdParamsDto) {
    return this.queries.detail(tenantId, params.loanId);
  }

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
