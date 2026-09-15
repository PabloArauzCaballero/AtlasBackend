import { describe, expect, it } from '@jest/globals';
import {
  baseAudiencePredicate,
  buildAudienceWhere,
  rulePredicate,
  type AudienceTables,
} from '../../../src/modules/customers/infrastructure/campaign-audience.sql.js';

/**
 * El constructor de audiencia es la única pieza que convierte lo que teclea operaciones en SQL. Lo que
 * se protege: los valores NUNCA se interpolan, una regla fuera del vocabulario revienta (no se degrada
 * a «todos»), y la negación de un atributo por dirección incluye a quien no tiene dirección.
 */
const tables: AudienceTables = {
  customers: 'customer.customers',
  profileVersions: 'customer.customer_profile_versions',
  addresses: 'customer.customer_addresses',
  addressVersions: 'customer.customer_address_versions',
  contactMethods: 'customer.customer_contact_methods',
  deviceTokens: 'messaging.device_tokens',
  loans: 'loan.loans',
  installments: 'loan.loan_installments',
  creditLines: 'credit.credit_lines',
};

describe('buildAudienceWhere', () => {
  it('sin reglas ni consentimiento es el universo de clientes activos', () => {
    const sql = buildAudienceWhere({ match: 'all', rules: [] }, { requireMarketingConsent: false }, tables);
    expect(sql.where).toBe(baseAudiencePredicate());
    expect(sql.replacements).toEqual({});
  });

  it('marketing exige el consentimiento vigente del perfil', () => {
    const sql = buildAudienceWhere({ match: 'all', rules: [] }, { requireMarketingConsent: true }, tables);
    expect(sql.where).toContain('customer.customer_profile_versions p');
    expect(sql.where).toContain('p.marketing_opt_in = true');
  });

  it('una ciudad va por replacement en minúsculas, nunca interpolada', () => {
    const sql = buildAudienceWhere(
      { match: 'all', rules: [{ attribute: 'city', operator: 'in', value: ['La Paz', "El Alto'; DROP TABLE x;--"] }] },
      { requireMarketingConsent: false },
      tables,
    );
    expect(sql.where).toContain('lower(v.city) IN (:rule0)');
    expect(sql.where).not.toContain('DROP');
    expect(sql.replacements.rule0).toEqual(['la paz', "el alto'; drop table x;--"]);
  });

  it('`any` combina las reglas con OR y `all` con AND', () => {
    const rules = [
      { attribute: 'hasActiveLoan', operator: 'is_true' },
      { attribute: 'hasPushDevice', operator: 'is_true' },
    ] as const;
    expect(buildAudienceWhere({ match: 'any', rules }, { requireMarketingConsent: false }, tables).where).toContain(') OR EXISTS');
    expect(buildAudienceWhere({ match: 'all', rules }, { requireMarketingConsent: false }, tables).where).toContain(') AND EXISTS');
  });
});

describe('rulePredicate', () => {
  const run = (rule: Parameters<typeof rulePredicate>[0]) => {
    const replacements: Record<string, unknown> = {};
    return { sql: rulePredicate(rule, tables, 'r', replacements), replacements };
  };

  it('negar una ciudad incluye a quien no tiene dirección (NOT EXISTS)', () => {
    expect(run({ attribute: 'department', operator: 'neq', value: 'Beni' }).sql).toMatch(/^NOT EXISTS/);
  });

  it('negar un estado de ciclo de vida incluye los NULL', () => {
    expect(run({ attribute: 'lifecycleStatus', operator: 'not_in', value: ['onboarding'] }).sql).toContain('c.lifecycle_status IS NULL OR');
  });

  it('las banderas booleanas se niegan con NOT', () => {
    expect(run({ attribute: 'hasOverdueInstallment', operator: 'is_true' }).sql).toContain("i.status = 'overdue'");
    expect(run({ attribute: 'hasCreditLine', operator: 'is_false' }).sql).toMatch(/^NOT EXISTS .*approved_limit > 0/);
    expect(run({ attribute: 'hasVerifiedEmail', operator: 'is_true' }).sql).toContain("m.status = 'verified'");
  });

  it('antigüedad: gte significa dado de alta hace al menos N días', () => {
    const { sql, replacements } = run({ attribute: 'daysSinceSignup', operator: 'gte', value: 30.7 });
    expect(sql).toContain('c._created_at <= now()');
    expect(replacements.r).toBe(30);
    expect(run({ attribute: 'daysSinceSignup', operator: 'lte', value: 7 }).sql).toContain('c._created_at >= now()');
  });

  it('la plataforma del push filtra dentro del EXISTS de dispositivos activos', () => {
    const { sql, replacements } = run({ attribute: 'pushPlatform', operator: 'eq', value: 'Android' });
    expect(sql).toContain('d.is_active = true AND lower(d.platform) IN (:r)');
    expect(replacements.r).toEqual(['android']);
  });

  it('rechaza operadores fuera del vocabulario y valores vacíos o negativos', () => {
    expect(() => run({ attribute: 'city', operator: 'gte', value: 3 })).toThrow('AUDIENCE_RULE_UNSUPPORTED');
    expect(() => run({ attribute: 'city', operator: 'eq', value: '   ' })).toThrow('AUDIENCE_RULE_INVALID_VALUE');
    expect(() => run({ attribute: 'daysSinceSignup', operator: 'gte', value: -1 })).toThrow('AUDIENCE_RULE_INVALID_VALUE');
  });
});
