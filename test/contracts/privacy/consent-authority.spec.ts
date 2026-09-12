/**
 * @file AT-028 — consentimiento por propósito, revocación idempotente y retención que no se borra a petición.
 * @business El consentimiento de otro propósito no autoriza; revocar dos veces deja una revocación; una
 *   solicitud de borrado no destruye evidencia con retención legal.
 * @system Reglas puras de los contratos; sin base.
 */
import { describe, expect, it } from '@jest/globals';
import { authorizes, type ConsentStatus } from '../../../src/modules/consents/public/consent-status.contracts.js';
import {
  assessRetentionPolicy,
  type PrivacyCommandPort,
  type RevokeConsentCommand,
} from '../../../src/modules/customer-privacy/application/ports/privacy-command.port.js';

const granted: ConsentStatus = {
  tenantId: '1',
  customerId: 'c',
  purposeCode: 'credit_evaluation',
  status: 'granted',
  revision: 'r1',
  grantedAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
  readAt: '2026-09-11T00:00:00.000Z',
};

/** Adaptador en memoria que cumple el contrato de idempotencia por commandKey. */
function inMemoryPrivacy(): PrivacyCommandPort & { revocations: RevokeConsentCommand[] } {
  const seen = new Map<string, { revision: string | null; effectiveAt: string }>();
  const revocations: RevokeConsentCommand[] = [];
  return {
    revocations,
    async revokeConsent(command) {
      const previous = seen.get(command.commandKey);
      if (previous) return { revoked: false, alreadyRevoked: true, ...previous };
      revocations.push(command);
      const result = { revision: `rev-${revocations.length}`, effectiveAt: '2026-09-11T00:00:00.000Z' };
      seen.set(command.commandKey, result);
      return { revoked: true, alreadyRevoked: false, ...result };
    },
    async assessRetention(_t, _c, kind) {
      return assessRetentionPolicy(kind, new Date('2026-09-11T00:00:00.000Z'));
    },
  };
}

describe('autoridad del consentimiento (AT-028)', () => {
  it('consentimiento de otro propósito: no autoriza', () => {
    expect(authorizes(granted, 'credit_evaluation')).toBe(true);
    expect(authorizes(granted, 'marketing')).toBe(false);
    expect(authorizes({ ...granted, status: 'revoked' }, 'credit_evaluation')).toBe(false);
  });

  it('revocación repetida: idempotente y con una sola entrada auditable', async () => {
    const port = inMemoryPrivacy();
    const command: RevokeConsentCommand = {
      tenantId: '1',
      customerId: 'c',
      purposeCode: 'marketing',
      reasonCode: 'customer_request',
      actor: { type: 'customer', id: 'c' },
      commandKey: 'revoke-1',
    };
    const first = await port.revokeConsent(command);
    const second = await port.revokeConsent(command);
    expect(first).toMatchObject({ revoked: true, alreadyRevoked: false });
    expect(second).toMatchObject({ revoked: false, alreadyRevoked: true, revision: first.revision });
    expect(port.revocations).toHaveLength(1);
  });

  it('solicitud de borrado: la evidencia con retención legal se conserva con plazo; lo demás es borrable', async () => {
    const verdict = await inMemoryPrivacy().assessRetention('1', 'c', 'erasure');
    expect(verdict.retained.map((r) => r.category)).toEqual(
      expect.arrayContaining(['identity_evidence', 'consent_records', 'fraud_cases', 'credit_history']),
    );
    expect(verdict.erasable).toEqual(expect.arrayContaining(['marketing_preferences', 'device_signals']));
    for (const item of verdict.retained) expect(item.until).toMatch(/^2036-/);
  });

  it('una solicitud de acceso no borra nada', async () => {
    const verdict = await inMemoryPrivacy().assessRetention('1', 'c', 'access');
    expect(verdict).toEqual({ erasable: [], retained: [] });
  });
});
