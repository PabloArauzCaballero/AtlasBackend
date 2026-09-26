/**
 * @file P-09 (B12) — una revocación bloquea en el core aunque el motor esté caído, y llega al motor después.
 * @business El titular retira un permiso con el motor fuera de servicio: el core no desembolsa una
 *   decisión que dependía de él, y la revocación se reintenta hasta que el motor la acusa.
 * @system Cola real (`decision_consent_replications`), comprobación real del desembolso y un motor
 *   doble cuyo transporte falla o responde a voluntad. Nada se da por replicado sin acuse.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { CustomerConsentModel, DecisionConsentReplicationModel, DecisionSubjectLinkModel } from '../../../src/database/models/index.js';
import { ConsentReplicationService } from '../../../src/modules/decision-engine/consent-replication.service.js';
import { ConsentReplicationStore } from '../../../src/modules/decision-engine/consent-replication.store.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildLoanBookHarness, type LoanBookHarness } from './support/loan-book-harness.js';

let database: IntegrationDatabase | null = null;
let harness: LoanBookHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildLoanBookHarness(database.sequelize);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (harness) {
    for (const table of ['credit.decision_consent_replications', 'credit.decision_subject_links', 'privacy.customer_consents']) {
      await harness.sequelize.query(`DELETE FROM ${table} WHERE _tenant_id = $tenantId`, { bind: { tenantId: harness.tenantId } });
    }
  }
  await harness?.cleanup();
  await database?.close();
});

/** Un motor doble: `up` decide si el transporte responde o falla como un motor caído. */
function engine(h: LoanBookHarness) {
  const state = { up: false, calls: [] as Array<{ url: string; body: Record<string, unknown> }> };
  const transport = {
    baseUrl: () => 'http://motor.invalid',
    call: jest.fn(async (url: string, _key: string, body: Record<string, unknown>) => {
      if (!state.up) throw new Error('ECONNREFUSED motor caído');
      state.calls.push({ url, body });
      return { status: 200, json: {} };
    }),
  };
  const store = new ConsentReplicationStore(DecisionConsentReplicationModel, h.sequelize);
  const client = new DecisionEngineClient(transport as never, store);
  jest.spyOn(client, 'isConfigured', 'get').mockReturnValue(true);
  const sync = new ConsentReplicationService(client, store);
  return { state, client, store, sync };
}

/** Un cliente que el motor conoce (sujeto de crédito) con un consentimiento otorgado. */
async function knownCustomerWithConsent(h: LoanBookHarness, purposeCode: string) {
  const customerId = await h.createCustomer();
  await h.createCreditLine(customerId, '1000.00');
  const now = new Date();
  const subjectReference = `subj-${randomUUID()}`;
  await DecisionSubjectLinkModel.create({
    tenantId: h.tenantId,
    customerId,
    subjectReference,
    purposeCode: 'credit_underwriting',
    firstSeenAt: now,
    lastSeenAt: now,
    decisionCount: 1,
    createdAtValue: now,
  } as never);
  const consent = await CustomerConsentModel.create({
    tenantId: h.tenantId,
    customerId,
    purposeCode,
    granted: true,
    grantedAt: new Date(now.getTime() - 3_600_000),
    revokedAt: null,
    channel: 'app',
    createdAtValue: now,
  } as never);
  return { customerId, subjectReference, consentId: String(consent.id) };
}

async function revoke(consentId: string, at = new Date()): Promise<void> {
  await CustomerConsentModel.update({ granted: false, revokedAt: at, updatedAtValue: at }, { where: { id: consentId } });
}

async function replicationOf(h: LoanBookHarness, customerId: string) {
  return h.query<{ action: string; status: string; attempts: number }>(
    'SELECT action, status, attempts FROM credit.decision_consent_replications WHERE _tenant_id = $tenantId AND customer_id = $customerId',
    { customerId },
  );
}

describe('P-09 · revocación con el motor caído (PostgreSQL real)', () => {
  it('revocación con el motor caído: queda pendiente, el core bloquea el desembolso, y el motor la recibe al volver', async () => {
    if (!harness) return;
    const motor = engine(harness);
    const { customerId, consentId, subjectReference } = await knownCustomerWithConsent(harness, 'bank_statement_analysis');
    const app = await harness.createApprovedApplication({ customerId, amount: '100.00', decidedAt: new Date(Date.now() - 60_000) });
    await revoke(consentId);

    const down = await motor.sync.sync({ tenantId: harness.tenantId, limit: 50 });
    expect(down).toMatchObject({ enqueued: 1, synced: 0, failed: 1, pendingRevocations: 1 });
    expect(await replicationOf(harness, customerId)).toEqual([{ action: 'revoke', status: 'pending', attempts: 1 }]);

    await expect(harness.disburse(app)).rejects.toThrow('CONSENT_REVOCATION_PENDING_SYNC');

    motor.state.up = true;
    const up = await motor.sync.sync({ tenantId: harness.tenantId, limit: 50, now: new Date(Date.now() + 2 * 3_600_000) });
    expect(up).toMatchObject({ synced: 1, failed: 0, pendingRevocations: 0 });
    // La revocación viaja con la fecha en que el titular revocó (P-09), no con la de la entrega.
    const [revocation] = await CustomerConsentModel.findAll({ where: { id: consentId } });
    expect(motor.state.calls).toEqual([
      {
        url: 'http://motor.invalid/v1/risk-governance/consents/revoke',
        body: { subjectReference, purpose: 'bank_statement_analysis', revokedAt: (revocation.revokedAt as Date).toISOString() },
      },
    ]);
    // Ya replicada, la decisión sigue sin servir: se tomó ANTES de la revocación.
    await expect(harness.disburse(app)).rejects.toThrow('CONSENT_REVOKED_AFTER_DECISION');
    // Una decisión nueva, posterior a la revocación, sí puede desembolsarse.
    const fresh = await harness.createApprovedApplication({ customerId, amount: '100.00' });
    await expect(harness.disburse(fresh)).resolves.toEqual(expect.objectContaining({ status: 'active' }));
  });

  it('una réplica de permiso con el motor caído no se pierde: queda pendiente y el reintentador la entrega', async () => {
    if (!harness) return;
    const motor = engine(harness);
    const { customerId, subjectReference } = await knownCustomerWithConsent(harness, 'credit_underwriting');

    const delivered = await motor.client.recordConsent({
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      purpose: 'credit_underwriting',
      basis: 'CREDIT_PROTECTION',
      grantedAt: new Date(),
    });
    expect(delivered).toBe(false);
    expect(await replicationOf(harness, customerId)).toEqual([{ action: 'grant', status: 'pending', attempts: 1 }]);

    motor.state.up = true;
    await motor.sync.sync({ tenantId: harness.tenantId, limit: 50, now: new Date(Date.now() + 2 * 3_600_000) });
    expect(await replicationOf(harness, customerId)).toEqual([{ action: 'grant', status: 'synced', attempts: 1 }]);
  });

  it('un permiso más viejo que una revocación pendiente no la pisa ni se entrega (no resucita lo retirado)', async () => {
    if (!harness) return;
    const motor = engine(harness);
    const { customerId, consentId, subjectReference } = await knownCustomerWithConsent(harness, 'credit_underwriting');
    await revoke(consentId);
    await motor.sync.sync({ tenantId: harness.tenantId, limit: 50 });
    motor.state.up = true;

    const delivered = await motor.client.recordConsent({
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      purpose: 'credit_underwriting',
      basis: 'CREDIT_PROTECTION',
      grantedAt: new Date(Date.now() - 86_400_000),
    });

    expect(delivered).toBe(false);
    expect(motor.state.calls).toEqual([]);
    expect(await replicationOf(harness, customerId)).toEqual([{ action: 'revoke', status: 'pending', attempts: 1 }]);
  });
});
