/**
 * @file Traduce una definición de audiencia a un predicado SQL parametrizado sobre `customers`.
 * @business «Clientes de Cochabamba con una cuota vencida y la app instalada» se convierte en una
 *   consulta que cuenta y lista exactamente a esas personas, sin exponer sus datos de contacto.
 * @system Función pura: recibe los nombres de tabla ya calificados y devuelve SQL + replacements. Los
 *   valores del operador NUNCA se interpolan: todo va por `replacements`. Lo único que se interpola son
 *   nombres de tabla escritos en el código y fragmentos fijos de este archivo.
 */
import {
  AUDIENCE_OPERATORS_BY_ATTRIBUTE,
  type AudienceDefinition,
  type AudienceOptions,
  type AudienceRule,
} from '../../../platform/contracts/campaign-audience.js';

export type AudienceTables = Readonly<{
  customers: string;
  profileVersions: string;
  addresses: string;
  addressVersions: string;
  contactMethods: string;
  deviceTokens: string;
  loans: string;
  installments: string;
  creditLines: string;
}>;

export type AudienceSql = { where: string; replacements: Record<string, unknown> };

/** El cliente que puede recibir algo: no borrado, no cerrado, no bloqueado. Es el universo de toda audiencia. */
export function baseAudiencePredicate(): string {
  return "c._tenant_id = :tenantId AND c._deleted IS DISTINCT FROM true AND c.closed_at IS NULL AND (c.lifecycle_status IS NULL OR c.lifecycle_status <> 'blocked')";
}

export function pushDevicePredicate(t: AudienceTables, extra = ''): string {
  return `EXISTS (SELECT 1 FROM ${t.deviceTokens} d WHERE d.customer_id = c._id AND d._tenant_id = c._tenant_id AND d.is_active = true${extra})`;
}

export function verifiedEmailPredicate(t: AudienceTables): string {
  return `EXISTS (SELECT 1 FROM ${t.contactMethods} m WHERE m.customer_id = c._id AND m.contact_type = 'email' AND m.status = 'verified' AND m._deleted IS DISTINCT FROM true)`;
}

function marketingPredicate(t: AudienceTables): string {
  return `EXISTS (SELECT 1 FROM ${t.profileVersions} p WHERE p._id = c.current_profile_version_id AND p.marketing_opt_in = true)`;
}

function addressPredicate(t: AudienceTables, column: 'city' | 'department', comparison: string): string {
  return `EXISTS (SELECT 1 FROM ${t.addresses} a JOIN ${t.addressVersions} v ON v._id = a.current_version_id WHERE a.customer_id = c._id AND a._deleted IS DISTINCT FROM true AND ${comparison.replace('$col', `lower(v.${column})`)})`;
}

function booleanPredicates(t: AudienceTables): Record<string, string> {
  return {
    hasCreditLine: `EXISTS (SELECT 1 FROM ${t.creditLines} l WHERE l.customer_id = c._id AND l._deleted IS DISTINCT FROM true AND l.approved_limit > 0 AND (l.valid_until IS NULL OR l.valid_until > now()))`,
    hasActiveLoan: `EXISTS (SELECT 1 FROM ${t.loans} o WHERE o.customer_id = c._id AND o.status = 'active' AND o._deleted IS DISTINCT FROM true)`,
    hasOverdueInstallment: `EXISTS (SELECT 1 FROM ${t.installments} i JOIN ${t.loans} o ON o._id = i.loan_id WHERE o.customer_id = c._id AND i.status = 'overdue' AND i._deleted IS DISTINCT FROM true)`,
    hasPushDevice: pushDevicePredicate(t),
    hasVerifiedEmail: verifiedEmailPredicate(t),
    marketingOptIn: marketingPredicate(t),
  };
}

function listOf(value: AudienceRule['value']): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

/** Traduce UNA regla. Lanza si el par atributo/operador no está en el vocabulario: nunca se degrada a TRUE. */
export function rulePredicate(rule: AudienceRule, t: AudienceTables, param: string, replacements: Record<string, unknown>): string {
  if (!AUDIENCE_OPERATORS_BY_ATTRIBUTE[rule.attribute]?.includes(rule.operator)) {
    throw new Error(`AUDIENCE_RULE_UNSUPPORTED: ${rule.attribute} ${rule.operator}`);
  }
  const booleans = booleanPredicates(t);
  if (rule.attribute in booleans) {
    const predicate = booleans[rule.attribute];
    return rule.operator === 'is_true' ? predicate : `NOT ${predicate}`;
  }
  if (rule.attribute === 'daysSinceSignup') {
    const days = Number(rule.value);
    if (!Number.isFinite(days) || days < 0) throw new Error('AUDIENCE_RULE_INVALID_VALUE: daysSinceSignup');
    replacements[param] = Math.floor(days);
    const comparator = rule.operator === 'gte' ? '<=' : '>=';
    return `c._created_at ${comparator} now() - (CAST(:${param} AS INTEGER) * INTERVAL '1 day')`;
  }
  const values = listOf(rule.value);
  if (values.length === 0) throw new Error(`AUDIENCE_RULE_INVALID_VALUE: ${rule.attribute}`);
  const negated = rule.operator === 'neq' || rule.operator === 'not_in';
  replacements[param] = values;
  if (rule.attribute === 'pushPlatform') return pushDevicePredicate(t, ` AND lower(d.platform) IN (:${param})`);
  if (rule.attribute === 'lifecycleStatus') {
    return negated
      ? `(c.lifecycle_status IS NULL OR lower(c.lifecycle_status) NOT IN (:${param}))`
      : `lower(c.lifecycle_status) IN (:${param})`;
  }
  const predicate = addressPredicate(t, rule.attribute as 'city' | 'department', `$col IN (:${param})`);
  return negated ? `NOT ${predicate}` : predicate;
}

export function buildAudienceWhere(definition: AudienceDefinition, options: AudienceOptions, tables: AudienceTables): AudienceSql {
  const replacements: Record<string, unknown> = {};
  const parts = [baseAudiencePredicate()];
  if (options.requireMarketingConsent) parts.push(marketingPredicate(tables));
  const rules = definition.rules.map((rule, index) => rulePredicate(rule, tables, `rule${index}`, replacements));
  if (rules.length > 0) parts.push(`(${rules.join(definition.match === 'any' ? ' OR ' : ' AND ')})`);
  return { where: parts.join(' AND '), replacements };
}
