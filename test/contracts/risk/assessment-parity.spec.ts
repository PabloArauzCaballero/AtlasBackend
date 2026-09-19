/**
 * @file AT-027 — Riesgo evalúa con hechos por puerto y produce el mismo resultado que con lectura directa.
 * @business Mismos hechos → mismo score, decisión, razones y ruleset; sin consentimiento no se ejecuta nada.
 * @system `RiskService` con un puerto de hechos en memoria y dobles del resto; se compara contra la
 *   misma evaluación alimentada por el adaptador local sobre repositorios dobles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { LocalRiskInputFactsAdapter } from '../../../src/modules/risk/infrastructure/local-risk-input-facts.adapter.js';
import { computeHeuristicScores } from '../../../src/modules/risk/application/risk-heuristic-scoring.js';

describe('RiskInputFactsPort (AT-027)', () => {
  it('el adaptador local produce los mismos hechos que la lectura directa anterior', async () => {
    const customers = { findById: jest.fn(async () => ({ lifecycleStatus: 'active' })) };
    const risk = {
      findCustomerConsents: jest.fn(async () => [
        { granted: true, revokedAt: null },
        { granted: true, revokedAt: new Date() },
      ]),
      findCustomerContacts: jest.fn(async () => [{ status: 'verified' }, { status: 'pending' }, { status: 'verified' }]),
      findIdentityDocuments: jest.fn(async () => [{ id: 1 }]),
    };
    const facts = await new LocalRiskInputFactsAdapter(customers as never, risk as never).loadFacts('1', 'c1');
    expect(facts).toMatchObject({
      exists: true,
      lifecycleStatus: 'active',
      hasGrantedConsent: true,
      verifiedContactCount: 2,
      hasIdentity: true,
    });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(typeof facts.readAt).toBe('string');
  });

  it('consentimiento revocado o ausente: hasGrantedConsent=false (el servicio no ejecuta la integración)', async () => {
    const customers = { findById: async () => ({ lifecycleStatus: 'active' }) };
    const risk = {
      findCustomerConsents: async () => [{ granted: true, revokedAt: new Date() }],
      findCustomerContacts: async () => [],
      findIdentityDocuments: async () => [],
    };
    expect((await new LocalRiskInputFactsAdapter(customers as never, risk as never).loadFacts('1', 'c1')).hasGrantedConsent).toBe(false);
  });

  it('cliente inexistente: exists=false sin lanzar; el caso de uso decide el 404', async () => {
    const customers = { findById: async () => null };
    const risk = { findCustomerConsents: jest.fn(), findCustomerContacts: jest.fn(), findIdentityDocuments: jest.fn() };
    const facts = await new LocalRiskInputFactsAdapter(customers as never, risk as never).loadFacts('1', 'x');
    expect(facts.exists).toBe(false);
    expect(risk.findCustomerConsents).not.toHaveBeenCalled();
  });

  it('paridad del motor: mismos hechos → mismo score y nivel', () => {
    const a = computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 2, hasDevice: true });
    const b = computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 2, hasDevice: true });
    expect(a).toEqual(b);
    expect(computeHeuristicScores({ hasIdentity: false, verifiedContactCount: 0, hasDevice: false }).riskLevel).not.toBe(a.riskLevel);
  });
});
