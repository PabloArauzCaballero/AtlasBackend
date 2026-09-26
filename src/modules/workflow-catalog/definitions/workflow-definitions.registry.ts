/**
 * @file Registro: todos los procesos de Atlas declarados en código.
 * @business Esta pieza es la lista única de procesos que existen; lo que no está aquí no está documentado.
 * @system `WORKFLOW_DEFINITIONS` es lo que vuelcan las migraciones `sync-workflow-catalog-N` y lo que validan los gates `check:process-*`.
 */
import { ACCOUNT_SIGNUP_TO_LOGIN } from './processes/account-signup-to-login.process.fixtures.js';
import { ACCOUNTING_DOCUMENTS_CYCLE } from './processes/accounting-documents-cycle.process.fixtures.js';
import { ADS_ADVERTISERS } from './processes/ads-advertisers.process.fixtures.js';
import { ATLAS_ASSIST_HELP } from './processes/atlas-assist-help.process.fixtures.js';
import { BANK_STATEMENT_CAPACITY } from './processes/bank-statement-capacity.process.fixtures.js';
import { BNPL_SALE_MDR_BILLING } from './processes/bnpl-sale-mdr-billing.process.fixtures.js';
import { COVERAGE_AND_RECOVERY } from './processes/coverage-and-recovery.process.fixtures.js';
import { CREDIT_LINE_AND_APPLICATION } from './processes/credit-line-and-application.process.fixtures.js';
import { CUSTOMER_CREDIT_JOURNEY } from './processes/customer-credit-journey.process.fixtures.js';
import { CUSTOMER_ELIGIBILITY_LIFECYCLE } from './processes/customer-eligibility-lifecycle.process.fixtures.js';
import { CUSTOMER_FULL_LIFECYCLE } from './processes/customer-full-lifecycle.process.fixtures.js';
import { CUSTOMER_ONBOARDING_KYC } from './processes/customer-onboarding-kyc.process.fixtures.js';
import { CUSTOMER_PARTNER_COMMERCE } from './processes/customer-partner-commerce.process.fixtures.js';
import { CUSTOMER_PRIVACY_DSR } from './processes/customer-privacy-dsr.process.fixtures.js';
import { CUSTOMER_SUPPORT_CASE } from './processes/customer-support-case.process.fixtures.js';
import { DASHBOARDS_KPI_AND_MANUAL_INPUTS } from './processes/dashboards-kpi-and-manual-inputs.process.fixtures.js';
import { DATA_GOVERNANCE_QUALITY_REPORTS } from './processes/data-governance-quality-reports.process.fixtures.js';
import { DECISION_ARTIFACT_GOVERNANCE } from './processes/decision-artifact-governance.process.fixtures.js';
import { DECISION_EXECUTION_AND_MANUAL_REVIEW } from './processes/decision-execution-and-manual-review.process.fixtures.js';
import { DECISION_QUALITY_AND_MONITORING } from './processes/decision-quality-and-monitoring.process.fixtures.js';
import { DEPLOY_AND_RELEASE } from './processes/deploy-and-release.process.fixtures.js';
import { DEVICE_SIGNALS_AND_SESSIONS } from './processes/device-signals-and-sessions.process.fixtures.js';
import { DOMAIN_EVENTS_OUTBOX } from './processes/domain-events-outbox.process.fixtures.js';
import { EXTERNAL_PROVIDERS_OPERATIONS } from './processes/external-providers-operations.process.fixtures.js';
import { FLOW_INTELLIGENCE_CYCLE } from './processes/flow-intelligence-cycle.process.fixtures.js';
import { IDENTITY_VERIFICATION } from './processes/identity-verification.process.fixtures.js';
import { INSTALLMENT_PAYMENT_CLAIMS } from './processes/installment-payment-claims.process.fixtures.js';
import { INTERNAL_USERS_RBAC } from './processes/internal-users-rbac.process.fixtures.js';
import { LOAN_SERVICING_COLLECTIONS } from './processes/loan-servicing-collections.process.fixtures.js';
import { MERCHANT_CONTRACT_AND_PRICING } from './processes/merchant-contract-and-pricing.process.fixtures.js';
import { MERCHANT_ONBOARDING_CHAIN } from './processes/merchant-onboarding-chain.process.fixtures.js';
import { MERCHANT_QR_POS_AND_FILE } from './processes/merchant-qr-pos-and-file.process.fixtures.js';
import { MERCHANT_SUPPORT } from './processes/merchant-support.process.fixtures.js';
import { MERCHANT_USERS_AND_ACCESS } from './processes/merchant-users-and-access.process.fixtures.js';
import { MOTOR_WORKERS } from './processes/motor-workers.process.fixtures.js';
import { NOTIFICATIONS_AND_CAMPAIGNS } from './processes/notifications-and-campaigns.process.fixtures.js';
import { ONBOARDING_RISK_ASSESSMENT } from './processes/onboarding-risk-assessment.process.fixtures.js';
import { POST_LOGIN_FIRST_SCREEN } from './processes/post-login-first-screen.process.fixtures.js';
import { PURCHASE_AND_DISBURSEMENT } from './processes/purchase-and-disbursement.process.fixtures.js';
import { RUNTIME_JOBS } from './processes/runtime-jobs.process.fixtures.js';
import { SCHEMA_CHANGE_MANAGEMENT } from './processes/schema-change-management.process.fixtures.js';
import { SYSTEMS_CATALOG_GOVERNANCE } from './processes/systems-catalog-governance.process.fixtures.js';
import type { WorkflowDefinitionFixture } from './workflow-definition.types.js';

/** Recorridos compuestos (`C-nn`) y procesos del inventario (`P-nn`), por id. */
export const WORKFLOW_DEFINITIONS: readonly WorkflowDefinitionFixture[] = [
  CUSTOMER_CREDIT_JOURNEY,
  POST_LOGIN_FIRST_SCREEN,
  CUSTOMER_FULL_LIFECYCLE,
  CUSTOMER_PARTNER_COMMERCE,
  ACCOUNT_SIGNUP_TO_LOGIN,
  CUSTOMER_ONBOARDING_KYC,
  IDENTITY_VERIFICATION,
  ONBOARDING_RISK_ASSESSMENT,
  CUSTOMER_ELIGIBILITY_LIFECYCLE,
  CREDIT_LINE_AND_APPLICATION,
  BANK_STATEMENT_CAPACITY,
  PURCHASE_AND_DISBURSEMENT,
  INSTALLMENT_PAYMENT_CLAIMS,
  LOAN_SERVICING_COLLECTIONS,
  CUSTOMER_PRIVACY_DSR,
  CUSTOMER_SUPPORT_CASE,
  NOTIFICATIONS_AND_CAMPAIGNS,
  ATLAS_ASSIST_HELP,
  DEVICE_SIGNALS_AND_SESSIONS,
  MERCHANT_ONBOARDING_CHAIN,
  MERCHANT_QR_POS_AND_FILE,
  MERCHANT_USERS_AND_ACCESS,
  MERCHANT_CONTRACT_AND_PRICING,
  BNPL_SALE_MDR_BILLING,
  COVERAGE_AND_RECOVERY,
  MERCHANT_SUPPORT,
  ACCOUNTING_DOCUMENTS_CYCLE,
  DASHBOARDS_KPI_AND_MANUAL_INPUTS,
  ADS_ADVERTISERS,
  DECISION_ARTIFACT_GOVERNANCE,
  DECISION_EXECUTION_AND_MANUAL_REVIEW,
  DECISION_QUALITY_AND_MONITORING,
  MOTOR_WORKERS,
  SYSTEMS_CATALOG_GOVERNANCE,
  FLOW_INTELLIGENCE_CYCLE,
  DOMAIN_EVENTS_OUTBOX,
  RUNTIME_JOBS,
  INTERNAL_USERS_RBAC,
  SCHEMA_CHANGE_MANAGEMENT,
  EXTERNAL_PROVIDERS_OPERATIONS,
  DATA_GOVERNANCE_QUALITY_REPORTS,
  DEPLOY_AND_RELEASE,
];
