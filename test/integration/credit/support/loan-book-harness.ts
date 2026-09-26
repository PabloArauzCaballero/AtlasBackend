/**
 * @file Andamiaje de integración del libro de préstamos: desembolso, cobro y aviso de pago (P-08, P-11).
 * @business Estas pruebas miden lo que sólo PostgreSQL contesta: qué se confirma junto, qué se ordena
 *   bajo un cerrojo y qué no puede escribirse dos veces.
 * @system Construye a mano los servicios reales del libro, de los avisos de pago y de la reserva de
 *   exposición sobre la base de integración. Sólo dobla lo que no es la propiedad medida: el almacén
 *   de archivos, el expediente y el directorio de comercios (el dueño de cada comercio es un valor fijo).
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { AuthenticatedUser } from '../../../../src/common/types/auth.types.js';
import {
  CreditApplicationEventModel,
  CreditApplicationModel,
  CreditExposureReservationModel,
  CreditLineModel,
  CreditProductModel,
  CustomerModel,
  EvidenceDocumentModel,
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentClaimModel,
  LoanPaymentModel,
  OutboxEventModel,
  TenantModel,
} from '../../../../src/database/models/index.js';
import { CreditRepository } from '../../../../src/modules/credit/credit.repository.js';
import { ExposureReservationService } from '../../../../src/modules/credit/application/exposure-reservation.service.js';
import type { InternalRbacRepository } from '../../../../src/modules/internal-users/internal-rbac.repository.js';
import { OriginationConsentCheck } from '../../../../src/modules/credit/application/origination-consent-check.service.js';
import { EventsRepository } from '../../../../src/modules/events/events.repository.js';
import { EventsService } from '../../../../src/modules/events/events.service.js';
import { LoanPaymentClaimsService } from '../../../../src/modules/loan-payment-claims/loan-payment-claims.service.js';
import { PartnerPaymentClaimsService } from '../../../../src/modules/loan-payment-claims/partner-payment-claims.service.js';
import { PaymentClaimsContextService } from '../../../../src/modules/loan-payment-claims/payment-claims.shared.js';
import { LoanDisbursementService } from '../../../../src/modules/loans/application/loan-disbursement.service.js';
import { LoanPaymentService } from '../../../../src/modules/loans/application/loan-payment.service.js';
import { LoansRepository } from '../../../../src/modules/loans/loans.repository.js';
import { runToken } from '../../support/database.js';

export const internalOperator: AuthenticatedUser = { sub: 'internal:it', role: 'internal_operator', internalUserId: null } as never;

/** El dueño de cada comercio es `7<id>` (numérico, como la columna): el directorio real no es lo que se mide aquí. */
export const merchantOf = (partnerProfileId: string): AuthenticatedUser =>
  ({ sub: `merchant:7${partnerProfileId}`, role: 'merchant', merchantUserId: `7${partnerProfileId}` }) as never;

export const customerUser = (customerId: string): AuthenticatedUser => ({ sub: `customer:${customerId}`, customerId, role: 'customer' });

export type LoanBookHarness = Awaited<ReturnType<typeof buildLoanBookHarness>>;

export async function buildLoanBookHarness(sequelize: Sequelize) {
  const token = runToken();
  const now = new Date();
  const tenant = await TenantModel.create({
    tenantCode: `itl-${token}`,
    legalName: `Integración libro ${token}`,
    countryCode: 'BO',
    status: 'active',
    createdAtValue: now,
    updatedAtValue: now,
    deleted: false,
  });
  const tenantId = String(tenant.id);
  const product = await CreditProductModel.create({
    tenantId,
    productCode: `ITL-${token}`,
    productName: 'Producto del libro de integración',
    currencyCode: 'BOB',
    minAmount: '10.00',
    maxAmount: '10000.00',
    minTermMonths: 1,
    maxTermMonths: 24,
    minMonthlyIncome: null,
    requiresManualReview: false,
    // Tasa cero: el cronograma de 1.000 en 3 cuotas sale 333,33 + 333,33 + 333,34, sin intereses que
    // distraigan de lo que se mide.
    annualInterestRate: '0.0000',
    status: 'active',
    effectiveFrom: null,
    effectiveUntil: null,
    createdAtValue: now,
    updatedAtValue: now,
    deleted: false,
  } as never);

  const loansRepository = new LoansRepository(
    LoanModel,
    LoanInstallmentModel,
    LoanPaymentModel,
    LoanPaymentAllocationModel,
    LoanEventModel,
    LoanOutcomeReportModel,
  );
  const creditRepository = new CreditRepository(CreditProductModel, CreditApplicationModel, CreditApplicationEventModel);
  const payments = new LoanPaymentService(loansRepository, sequelize);
  const exposure = new ExposureReservationService(CreditExposureReservationModel, sequelize);
  const consentCheck = new OriginationConsentCheck(sequelize);
  // El override de tasa (T-5) es de un permiso RBAC que este harness de integración no ejercita:
  // ninguna prueba aquí pide desembolsar fuera del rango del producto, así que un stub que siempre
  // niega es correcto — la ruta con permiso real ya la cubre loan-disbursement.service.spec.ts.
  const rbacStub = { hasPermissions: async () => false } as unknown as InternalRbacRepository;
  const disbursement = new LoanDisbursementService(loansRepository, creditRepository, sequelize, exposure, consentCheck, rbacStub);
  const events = new EventsService(new EventsRepository(OutboxEventModel, sequelize), {} as never);
  const contexto = new PaymentClaimsContextService(loansRepository, creditRepository);
  const storage = {
    isConfigured: () => true,
    getBucket: () => 'it-bucket',
    readObjectMetadata: async () => ({ sha256Hex: 'ab'.repeat(32), sizeBytes: 1024 }),
  };
  const partners = { requireProfile: async (_tenantId: string, id: string) => ({ id, ownerMerchantUserId: `7${id}` }) };
  const claims = new LoanPaymentClaimsService(sequelize, LoanPaymentClaimModel, storage as never, EvidenceDocumentModel, events, contexto, {
    alRegistrarEvidencia: async () => undefined,
  } as never);
  const partnerClaims = new PartnerPaymentClaimsService(
    LoanPaymentClaimModel,
    storage as never,
    EvidenceDocumentModel,
    payments,
    partners as never,
    events,
    sequelize,
    contexto,
  );

  const createCustomer = async (): Promise<string> => {
    const created = await CustomerModel.create({
      tenantId,
      customerCode: `C-${runToken()}`,
      customerUuid: randomUUID(),
      lifecycleStatus: 'active',
      createdAtValue: new Date(),
      updatedAtValue: new Date(),
      deleted: false,
    });
    return String(created.id);
  };

  const createCreditLine = async (customerId: string, approvedLimit: string, currencyCode = 'BOB'): Promise<void> => {
    await CreditLineModel.create({
      tenantId,
      customerId,
      currencyCode,
      approvedLimit,
      decisionOutcome: 'APPROVE',
      calculationTrigger: 'manual',
      validFrom: new Date(),
      validUntil: null,
      createdAtValue: new Date(),
      updatedAtValue: new Date(),
      deleted: false,
    } as never);
  };

  /** Una solicitud ya aprobada y aceptada: lo que el desembolso necesita encontrar. */
  const createApprovedApplication = async (input: {
    customerId: string;
    amount: string;
    termMonths?: number;
    partnerProfileId?: string | null;
    decidedAt?: Date;
    businessAcceptance?: string | null;
  }): Promise<string> => {
    const decidedAt = input.decidedAt ?? new Date();
    const created = await CreditApplicationModel.create({
      tenantId,
      applicationCode: `APP-${runToken()}`,
      customerId: input.customerId,
      creditProductId: String(product.id),
      partnerProfileId: input.partnerProfileId ?? null,
      requestedAmount: input.amount,
      requestedTermMonths: input.termMonths ?? 3,
      currencyCode: 'BOB',
      status: 'approved',
      eligibilitySnapshotJson: {},
      decisionMode: 'decision_engine',
      decisionExecutionId: `exec-${runToken()}`,
      businessAcceptance: input.businessAcceptance === undefined ? 'accepted' : input.businessAcceptance,
      decidedAt,
      submittedAt: decidedAt,
      createdAtValue: decidedAt,
      updatedAtValue: decidedAt,
      deleted: false,
    } as never);
    return String(created.id);
  };

  const disburse = async (applicationId: string, idempotencyKey = `disb-${applicationId}`) =>
    disbursement.disburse({ tenantId, applicationId, body: {} as never, currentUser: internalOperator, idempotencyKey });

  /** Un préstamo vivo de 1.000 en tres cuotas, originado por el comercio `partnerProfileId`. */
  const createLoan = async (partnerProfileId: string) => {
    const customerId = await createCustomer();
    await createCreditLine(customerId, '5000.00');
    const applicationId = await createApprovedApplication({ customerId, amount: '1000.00', partnerProfileId });
    const loan = await disburse(applicationId);
    const installments = await LoanInstallmentModel.findAll({
      where: { tenantId, loanId: loan.loanId },
      order: [['installmentNumber', 'ASC']],
    });
    return { customerId, applicationId, loanId: String(loan.loanId), installments };
  };

  const query = <T extends object>(sql: string, bind: Record<string, unknown> = {}) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT, bind: { tenantId, ...bind } });

  return {
    sequelize,
    tenantId,
    productId: String(product.id),
    loansRepository,
    creditRepository,
    payments,
    exposure,
    disbursement,
    events,
    claims,
    partnerClaims,
    createCustomer,
    createCreditLine,
    createApprovedApplication,
    disburse,
    createLoan,
    query,
    cleanup: async () => {
      for (const table of [
        'platform_ops.outbox_events',
        // P-14: las entregas al ERP nacen con cada payment.* y la proyección de cobertura lleva el tenant.
        'platform_ops.outbound_event_deliveries',
        'credit.installment_coverage_projections',
        'credit.loan_payment_claims',
        'credit.loan_payment_allocations',
        'credit.loan_payments',
        'credit.loan_events',
        'credit.loan_installments',
        'credit.credit_exposure_reservations',
        'credit.loans',
        'privacy.evidence_documents',
        'credit.credit_application_events',
        'credit.credit_applications',
        'credit.credit_lines',
        'customer.customers',
        'credit.credit_products',
        'iam.tenants',
      ]) {
        const column = table === 'iam.tenants' ? '_id' : '_tenant_id';
        await sequelize.query(`DELETE FROM ${table} WHERE ${column} = $tenantId`, { bind: { tenantId } });
      }
    },
  };
}
