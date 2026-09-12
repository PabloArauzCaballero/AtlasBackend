/**
 * @file Andamiaje de las pruebas de integración de la admisión de crédito (AT-006, AT-007, AT-008).
 * @business Estas pruebas miden lo que sólo PostgreSQL puede contestar: qué fila enlaza una
 *   solicitud, qué queda escrito tras una denegación y cómo se ordenan dos decisiones concurrentes.
 * @system Construye a mano los servicios reales de Clientes y Crédito sobre la base de integración
 *   —repositorios con modelos Sequelize de verdad, nada en memoria— y sólo dobla lo que no forma
 *   parte de la propiedad medida: el motor de decisión y el directorio de comercios.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { CreditApplicationAdmissionService } from '../../../../src/modules/credit/application/credit-application-admission.service.js';
import { CreditRepository } from '../../../../src/modules/credit/credit.repository.js';
import { CustomerEligibilityService } from '../../../../src/modules/customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../../../src/modules/customers/application/customer-lifecycle.service.js';
import {
  IDENTITY_VERIFIED_RESULT,
  REQUIRED_FINANCIAL_ATTRIBUTE_CODES,
  RISK_APPROVED_ACTION,
} from '../../../../src/modules/customers/customer-eligibility.constants.js';
import { CustomersRepository } from '../../../../src/modules/customers/customers.repository.js';
import type { EligibilityFacts } from '../../../../src/modules/customers/repositories/customer-eligibility.facts.js';
import { CustomerEligibilityRepository } from '../../../../src/modules/customers/repositories/customer-eligibility.repository.js';
import { CustomerEligibilityRiskRepository } from '../../../../src/modules/customers/repositories/customer-eligibility-risk.repository.js';
import { CustomerLifecycleRepository } from '../../../../src/modules/customers/repositories/customer-lifecycle.repository.js';
import {
  AttributeDefinitionModel,
  AuthCredentialModel,
  ConsentDocumentModel,
  CreditApplicationEventModel,
  CreditApplicationModel,
  CreditProductModel,
  CustomerAddressModel,
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerEligibilityEvaluationModel,
  CustomerIdentityDocumentModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
  CustomerStatusEventModel,
  DataQualityIssueModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  FraudCaseModel,
  IdentityVerificationAttemptModel,
  ManualReviewCaseModel,
  OnboardingFlowModel,
  OutboxEventModel,
  RiskAssessmentResultModel,
  TenantModel,
  WatchlistMatchModel,
  CustomerAttributeValueModel,
} from '../../../../src/database/models/index.js';
import type { AuthenticatedUser } from '../../../../src/common/types/auth.types.js';
import { runToken } from '../../support/database.js';

export type AdmissionHarness = {
  sequelize: Sequelize;
  tenantId: string;
  productId: string;
  admission: CreditApplicationAdmissionService;
  eligibilityService: CustomerEligibilityService;
  eligibilityRepository: CustomerEligibilityRepository;
  lifecycleService: CustomerLifecycleService;
  createCustomer: (lifecycleStatus?: string) => Promise<string>;
  countEvaluations: (customerId: string) => Promise<number>;
  countApplications: (customerId: string) => Promise<number>;
  latestEvaluationId: (customerId: string) => Promise<string | null>;
  applicationEvaluationIds: (customerId: string) => Promise<string[]>;
  cleanup: () => Promise<void>;
};

const now = (): Date => new Date();

/** Un conjunto de hechos que la regla vigente considera elegible. Sólo se usa doblando `loadFacts`. */
export function eligibleFacts(): EligibilityFacts {
  return {
    hasCredentials: true,
    verifiedContactCount: 1,
    profile: { firstName: 'Ana', lastName: 'Pérez', birthDate: '1990-01-01' } as unknown as EligibilityFacts['profile'],
    presentFinancialAttributeCodes: [...REQUIRED_FINANCIAL_ATTRIBUTE_CODES],
    financialAttributeValues: { monthly_income_declared: 8000 },
    financialAttributeTexts: { employment_status: 'employee' },
    hasCurrentAddress: true,
    referenceContactCount: 5,
    identityDocument: { expiresAt: null } as unknown as EligibilityFacts['identityDocument'],
    identityVerificationResult: IDENTITY_VERIFIED_RESULT,
    pendingEvidenceReviewCount: 0,
    grantedConsentDocumentIds: [],
    requiredConsentDocumentIds: [],
    openObservationCount: 0,
    unclearedWatchlistMatchCount: 0,
    latestRisk: { recommendedAction: RISK_APPROVED_ACTION, decidedAt: now() } as unknown as EligibilityFacts['latestRisk'],
    openFraudCaseCount: 0,
  };
}

export const customerUser = (customerId: string): AuthenticatedUser => ({ sub: `customer:${customerId}`, customerId, role: 'customer' });

export async function buildAdmissionHarness(sequelize: Sequelize): Promise<AdmissionHarness> {
  const token = runToken();
  const timestamp = now();
  const tenant = await TenantModel.create({
    tenantCode: `it-${token}`,
    legalName: `Integración ${token}`,
    countryCode: 'BO',
    status: 'active',
    createdAtValue: timestamp,
    updatedAtValue: timestamp,
    deleted: false,
  });
  const tenantId = String(tenant.id);
  const product = await CreditProductModel.create({
    tenantId,
    productCode: `IT-${token}`,
    productName: 'Producto de integración',
    currencyCode: 'BOB',
    minAmount: '100.00',
    maxAmount: '10000.00',
    minTermMonths: 1,
    maxTermMonths: 24,
    minMonthlyIncome: null,
    requiresManualReview: false,
    status: 'active',
    effectiveFrom: null,
    effectiveUntil: null,
    createdAtValue: timestamp,
    updatedAtValue: timestamp,
    deleted: false,
  });

  const riskRepository = new CustomerEligibilityRiskRepository(
    DataQualityIssueModel,
    WatchlistMatchModel,
    RiskAssessmentResultModel,
    FraudCaseModel,
    ManualReviewCaseModel,
  );
  const eligibilityRepository = new CustomerEligibilityRepository(
    AuthCredentialModel,
    CustomerContactMethodModel,
    CustomerProfileVersionModel,
    CustomerAttributeValueModel,
    AttributeDefinitionModel,
    CustomerAddressModel,
    CustomerReferenceContactModel,
    CustomerIdentityDocumentModel,
    IdentityVerificationAttemptModel,
    EvidenceDocumentModel,
    EvidenceReviewModel,
    CustomerConsentModel,
    ConsentDocumentModel,
    OnboardingFlowModel,
    riskRepository,
  );
  const lifecycleRepository = new CustomerLifecycleRepository(
    CustomerModel,
    CustomerStatusEventModel,
    CustomerEligibilityEvaluationModel,
    OutboxEventModel,
  );
  const customersRepository = new CustomersRepository(
    CustomerModel,
    CustomerProfileVersionModel,
    CustomerStatusEventModel,
    CustomerConsentModel,
    RiskAssessmentResultModel,
  );
  const lifecycleService = new CustomerLifecycleService(lifecycleRepository);
  const eligibilityService = new CustomerEligibilityService(
    customersRepository,
    eligibilityRepository,
    lifecycleRepository,
    lifecycleService,
    sequelize,
  );
  const creditRepository = new CreditRepository(CreditProductModel, CreditApplicationModel, CreditApplicationEventModel);
  // Fuera de la propiedad medida: el motor decide DESPUÉS de confirmar la solicitud, y el comercio
  // sólo se resuelve cuando la solicitud lo declara (estas pruebas no lo declaran).
  const underwriting = {
    underwrite: async () => ({ status: 'under_review', decisionMode: 'engine_unavailable_manual', executionId: null, reasonCodes: [] }),
  };
  const partnerProfiles = { requireProfile: async () => ({ id: '0', onboardingStatus: 'approved' }) };
  const partnerDirectory = { findOwnedTerminal: async () => null };
  const admission = new CreditApplicationAdmissionService(
    creditRepository,
    eligibilityService,
    eligibilityRepository,
    underwriting as never,
    partnerProfiles as never,
    partnerDirectory as never,
    sequelize,
  );

  const createCustomer = async (lifecycleStatus = 'active'): Promise<string> => {
    const created = await CustomerModel.create({
      tenantId,
      customerCode: `C-${runToken()}`,
      customerUuid: randomUUID(),
      lifecycleStatus,
      createdAtValue: now(),
      updatedAtValue: now(),
      deleted: false,
    });
    return String(created.id);
  };

  const count = async (sql: string, customerId: string): Promise<number> => {
    const rows = await sequelize.query<{ n: string }>(sql, {
      type: QueryTypes.SELECT,
      bind: { tenantId, customerId },
    });
    return Number(rows[0]?.n ?? 0);
  };

  return {
    sequelize,
    tenantId,
    productId: String(product.id),
    admission,
    eligibilityService,
    eligibilityRepository,
    lifecycleService,
    createCustomer,
    countEvaluations: (customerId) =>
      count(
        'SELECT count(*)::text AS n FROM customer.customer_eligibility_evaluations WHERE _tenant_id = $tenantId AND customer_id = $customerId',
        customerId,
      ),
    countApplications: (customerId) =>
      count(
        'SELECT count(*)::text AS n FROM credit.credit_applications WHERE _tenant_id = $tenantId AND customer_id = $customerId',
        customerId,
      ),
    latestEvaluationId: async (customerId) => {
      const rows = await sequelize.query<{ id: string }>(
        'SELECT _id::text AS id FROM customer.customer_eligibility_evaluations WHERE _tenant_id = $tenantId AND customer_id = $customerId ORDER BY evaluated_at DESC, _id DESC LIMIT 1',
        { type: QueryTypes.SELECT, bind: { tenantId, customerId } },
      );
      return rows[0]?.id ?? null;
    },
    applicationEvaluationIds: async (customerId) => {
      const rows = await sequelize.query<{ id: string | null }>(
        'SELECT eligibility_evaluation_id::text AS id FROM credit.credit_applications WHERE _tenant_id = $tenantId AND customer_id = $customerId ORDER BY _id',
        { type: QueryTypes.SELECT, bind: { tenantId, customerId } },
      );
      return rows.map((row) => row.id ?? 'null');
    },
    cleanup: async () => {
      // En orden de dependencia; todo lo que estas pruebas escriben lleva el tenant de la corrida.
      for (const table of [
        'credit.credit_application_events',
        'credit.credit_applications',
        'customer.customer_eligibility_evaluations',
        'customer.customer_status_events',
        'platform_ops.outbox_events',
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
