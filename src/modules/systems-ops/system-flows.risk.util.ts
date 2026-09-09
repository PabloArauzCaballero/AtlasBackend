/**
 * @file Utilidad de dominio: clasifica un flujo derivado (tipo, riesgo, insignias) sin mirar la base.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system deriva riesgo e identidad estable de un flujo a partir de método, ruta y módulo.
 */
import { createHash } from 'node:crypto';
import { DerivedEndpointDto, FlowAnalysis } from './system-flows.schemas.js';

export type FlowKind = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION';
export type FlowRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Riesgo por módulo, fase 1 («module-heuristic»).
 *
 * En fase 2 el riesgo sale de las TABLAS que escribe cada flujo (PLAN.md §7). Hasta entonces se
 * aproxima por el módulo del controller, que en los tres bloques coincide con el dominio de datos.
 * La lista es un dato, no una regla: se corrige aquí y se re-importa; por eso `riskBasis` queda
 * guardado en cada fila, para que nadie confunda esta aproximación con la medida real.
 */
const CRITICAL_MODULES =
  /^(loans?|loan-payment-claims|credit|credit-rating|auth|internal-users|sessions|consents|customer-privacy|risk|merchant-identity|mobile-identity|identity|approvals?|deployments?|policies|policy|identity-session|decisions?|accounting|journal|payments?|treasury|bnpl|tax|close)/;
const HIGH_MODULES =
  /^(customers?|customer-onboarding|expedientes|partner-onboarding|partners?|merchant|manual-review|fraud|support|notifications|external-data|sql-console|data-notebook|workflow-catalog|systems-ops|internal-portal|onboarding|reconciliation|bank|contracts?|business-partner)/;
const ACTION_SEGMENT =
  /^(run|cancel|retry|submit|approve|reject|review|refresh|login|logout|federate|discover|queue-run|reorder|accept|decline|confirm|resend|verify|activate|deactivate|publish|deploy|rollback|assign|close|reopen|process|sync|infer-[a-z-]+|catalog-seed)$/;

const PII_MODULES = /^(customers?|customer-|expedientes|identity|mobile-identity|merchant-users|support|consents|customer-privacy)/;
const FINANCIAL_MODULES = /^(loans?|loan-|credit|payments?|accounting|journal|bnpl|treasury|tax|billing)/;
const IDENTITY_MODULES = /^(auth|identity|sessions|merchant-identity|mobile-identity|identity-session|internal-users)/;
const ADMIN_MODULES = /^(internal-users|systems-ops|internal-portal|sql-console|schema-management|runtime-jobs)/;

/**
 * Riesgo por TABLAS escritas, fase 2 («tables-written»): la lista del PLAN §7 sobre nombres reales de
 * los tres bloques. Es un dato: se corrige aquí y se re-importa.
 */
const CRITICAL_TABLES =
  /^(loans?|loan_[a-z_]+|credit_applications?|credit_lines|credit_application_events|customer_identity_documents|identity_verification_attempts|auth_[a-z_]+|internal_[a-z_]+|platform_users|risk_policy_rules|risk_ruleset_versions|risk_model_versions|consent_[a-z_]+|customer_consents|decision_deployment[a-z_]*|decision_approval_[a-z_]+|decision_artifact_version|decision_policy_[a-z_]+|decision_identity_verification_run|decision_manual_review_case|decision_data_subject_request|journal_entry[a-z_]*|ledger|payment_order|supplier_payment|merchant_payments|merchant_invoices|merchant_credit_notes|consumer_payments_to_merchant|bnpl_[a-z_]+|loan_contract|electronic_tax_document|close_run)$/;
const HIGH_TABLES =
  /^(customers?|customer_[a-z_]+|expediente[a-z_]*|partner_[a-z_]+|merchant_[a-z_]+|manual_review_[a-z_]+|fraud_[a-z_]+|notification_policies|data_subject_requests|decision_execution[a-z_]*|decision_outbox_event|decision_reason_code|decision_calculated_field[a-z_]*|merchant_onboarding_cases|business_partner[a-z_]*|contract_[a-z_]+|bank_statement[a-z_]*|reconciliation_[a-z_]+|merchant_receivables|merchant_payables|ar_invoice[a-z_]*|ap_invoice[a-z_]*)$/;
const SENSITIVE_READS =
  /^(customer_identity_documents|identity_verification_attempts|credit_applications?|loans?|loan_[a-z_]+|journal_entry[a-z_]*|auth_credentials)$/;

export function flowRiskFromTables(analysis: FlowAnalysis, kind: FlowKind, isPublicWrite: boolean): FlowRisk {
  if (isPublicWrite) return 'CRITICAL';
  const written = analysis.writes.map((w) => w.table);
  if (kind === 'DELETE' || written.some((t) => CRITICAL_TABLES.test(t))) return 'CRITICAL';
  if (written.some((t) => HIGH_TABLES.test(t))) return 'HIGH';
  if (written.length) return 'MEDIUM';
  if (analysis.reads.some((t) => SENSITIVE_READS.test(t))) return 'MEDIUM';
  return 'LOW';
}

export function flowKindFor(method: string, path: string): FlowKind {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'READ';
  if (method === 'DELETE') return 'DELETE';
  const last = path.split('/').filter(Boolean).at(-1) ?? '';
  if (ACTION_SEGMENT.test(last)) return 'ACTION';
  if (method === 'POST') return 'CREATE';
  return 'UPDATE';
}

export function flowRiskFor(
  endpoint: Pick<DerivedEndpointDto, 'method' | 'module' | 'isPublic' | 'roles' | 'internalPermissions'>,
  kind: FlowKind,
): FlowRisk {
  const writes = kind !== 'READ';
  const critical = CRITICAL_MODULES.test(endpoint.module);
  const high = HIGH_MODULES.test(endpoint.module);
  if (writes && endpoint.isPublic && !endpoint.roles.length && !endpoint.internalPermissions.length && !/^auth$/.test(endpoint.module))
    return 'CRITICAL';
  if (writes && critical) return 'CRITICAL';
  if (kind === 'DELETE') return 'HIGH';
  if (writes && high) return 'HIGH';
  if (writes) return 'MEDIUM';
  if (critical) return 'MEDIUM';
  return 'LOW';
}

export function flowBadgesFor(endpoint: Pick<DerivedEndpointDto, 'module'>, kind: FlowKind): string[] {
  const badges: string[] = [];
  if (kind === 'DELETE') badges.push('DESTRUCTIVE');
  if (PII_MODULES.test(endpoint.module)) badges.push('PII');
  if (FINANCIAL_MODULES.test(endpoint.module)) badges.push('FINANCIAL');
  if (IDENTITY_MODULES.test(endpoint.module)) badges.push('IDENTITY');
  if (ADMIN_MODULES.test(endpoint.module)) badges.push('ADMIN');
  return badges;
}

/** Identidad estable: bloque + método + ruta. Sobrevive a recargas y a la federación; un secuencial no. */
export function flowIdFor(systemCode: string, method: string, path: string): string {
  return `flow_${createHash('sha1').update(`${systemCode}|${method}|${path}`).digest('hex').slice(0, 12)}`;
}

export function flowSlugFor(systemCode: string, endpoint: Pick<DerivedEndpointDto, 'module' | 'controller' | 'handler'>): string {
  const kebab = (value: string) =>
    value
      .replace(/Controller$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .replace(/^-|-$/g, '');
  return `${systemCode.toLowerCase().replace(/_/g, '-')}.${kebab(endpoint.module)}.${kebab(endpoint.controller)}.${kebab(endpoint.handler)}`;
}

/** Nombre legible a partir del handler: `listStressProfiles` → «List stress profiles». No traduce: no inventa. */
export function flowNameFor(endpoint: Pick<DerivedEndpointDto, 'handler' | 'method' | 'path'>): string {
  const words = endpoint.handler
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  const label = words ? words.charAt(0).toUpperCase() + words.slice(1) : endpoint.handler;
  return `${label} (${endpoint.method} /${endpoint.path})`.slice(0, 220);
}

export function findingKeyFor(finding: { kind: string; systemCode: string; ref: string }): string {
  return createHash('sha1').update(`${finding.kind}|${finding.systemCode}|${finding.ref}`).digest('hex');
}
