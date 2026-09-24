/**
 * @file P-09/P-11 contra PostgreSQL real — base habilitante antes de decidir, réplica superada y
 *   vigencia que el motor pone a su decisión.
 * @business El motor no decide sin base: Core la deja escrita y entregada ANTES de preguntar, con la
 *   misma fecha en cada reintento; un 409 terminal se resuelve; una aprobación caducada en el motor
 *   no se desembolsa aunque la vigencia propia del core siga abierta; una solicitud diferida se decide
 *   sola cuando la base llega.
 * @system cola real (`decision_consent_replications`, CHECK ampliado), columna real
 *   `credit_applications.decision_valid_until`, desembolso y repositorio reales; el motor es un doble.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { CreditApplicationModel, DecisionConsentReplicationModel } from '../../../src/database/models/index.js';
import { CreditUnderwritingService, DEFERRED_BASIS_REASON } from '../../../src/modules/credit/application/credit-underwriting.service.js';
import { ConsentReplicationStore } from '../../../src/modules/decision-engine/consent-replication.store.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { ensureUnderwritingBasis } from '../../../src/modules/decision-engine/underwriting-basis.js';
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
    for (const table of ['credit.decision_consent_replications', 'credit.credit_application_events']) {
      await harness.sequelize.query(`DELETE FROM ${table} WHERE _tenant_id = $tenantId`, { bind: { tenantId: harness.tenantId } });
    }
  }
  await harness?.cleanup();
  await database?.close();
});

/** Motor doble: `mode` decide si el alta de base llega, falla o vuelve 409 terminal. */
function engine(h: LoanBookHarness) {
  const state = { mode: 'down' as 'down' | 'up' | 'replayed', calls: [] as Array<{ url: string; body: Record<string, unknown> }> };
  const transport = {
    baseUrl: () => 'http://motor.invalid',
    call: jest.fn(async (url: string, _key: string, body: Record<string, unknown>) => {
      if (state.mode === 'down') throw new Error('ECONNREFUSED motor caído');
      state.calls.push({ url, body });
      if (state.mode === 'replayed') {
        throw Object.assign(new Error('HTTP 409'), { httpStatus: 409, cause: { error: { code: 'CONSENT_GRANT_REPLAYED' } } });
      }
      return { status: 200, ok: true, json: { id: '1' } };
    }),
  };
  const store = new ConsentReplicationStore(DecisionConsentReplicationModel, h.sequelize);
  const client = new DecisionEngineClient(transport as never, store);
  jest.spyOn(client, 'isConfigured', 'get').mockReturnValue(true);
  return { state, client };
}

async function replication(h: LoanBookHarness, subjectReference: string) {
  return h.query<{ action: string; status: string; basis: string; granted_at: Date; resolution_code: string | null }>(
    `SELECT action, status, basis, granted_at, resolution_code FROM credit.decision_consent_replications
      WHERE _tenant_id = $tenantId AND subject_reference = $subjectReference`,
    { subjectReference },
  );
}

describe('P-09 · base habilitante antes de la primera decisión (PostgreSQL real)', () => {
  it('con el motor caído queda pendiente y NO se puede decidir; al volver se entrega con la MISMA fecha de alta', async () => {
    if (!harness) return;
    const motor = engine(harness);
    const customerId = await harness.createCustomer();
    const subjectReference = `subj-${randomUUID()}`;
    const first = new Date(Date.now() - 60_000);

    const down = await ensureUnderwritingBasis(motor.client.consents, {
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      now: first,
    });
    expect(down).toMatchObject({ status: 'pending', marker: null });
    const [pending] = await replication(harness, subjectReference);
    expect(pending).toMatchObject({ action: 'grant', status: 'pending', basis: 'CREDIT_PROTECTION' });
    expect(new Date(pending.granted_at).getTime()).toBe(first.getTime());

    motor.state.mode = 'up';
    const up = await ensureUnderwritingBasis(motor.client.consents, {
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      now: new Date(),
    });
    expect(up).toEqual({ status: 'ready', marker: String(first.getTime()) });
    expect(motor.state.calls).toHaveLength(1);
    expect(motor.state.calls[0].body).toMatchObject({ basis: 'CREDIT_PROTECTION', grantedAt: first.toISOString() });
    expect((await replication(harness, subjectReference))[0].status).toBe('synced');

    // Acusada: la siguiente decisión no vuelve a llamar al motor y usa la misma marca (misma clave).
    const again = await ensureUnderwritingBasis(motor.client.consents, {
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      now: new Date(),
    });
    expect(again).toEqual(up);
    expect(motor.state.calls).toHaveLength(1);
  });

  it('409 CONSENT_GRANT_REPLAYED queda `superseded` con su motivo (el CHECK lo admite) y no se reintenta', async () => {
    if (!harness) return;
    const motor = engine(harness);
    motor.state.mode = 'replayed';
    const customerId = await harness.createCustomer();
    const subjectReference = `subj-${randomUUID()}`;

    const readiness = await ensureUnderwritingBasis(motor.client.consents, {
      tenantId: harness.tenantId,
      customerId,
      subjectReference,
      now: new Date(),
    });

    expect(readiness.status).toBe('superseded');
    expect(await replication(harness, subjectReference)).toEqual([
      expect.objectContaining({ action: 'grant', status: 'superseded', resolution_code: 'CONSENT_GRANT_REPLAYED' }),
    ]);
    const due = await new ConsentReplicationStore(DecisionConsentReplicationModel, harness.sequelize).listDue({
      tenantId: harness.tenantId,
      limit: 50,
      now: new Date(Date.now() + 86_400_000),
    });
    expect(due.filter((row) => row.subjectReference === subjectReference)).toEqual([]);
  });
});

describe('P-11 · la vigencia del motor acota la concesión (PostgreSQL real)', () => {
  it('una aprobación caducada en el motor no se desembolsa aunque la del core siga abierta', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    await harness.createCreditLine(customerId, '1000.00');
    const application = await harness.createApprovedApplication({
      customerId,
      amount: '100.00',
      decidedAt: new Date(Date.now() - 2 * 3_600_000),
    });
    await CreditApplicationModel.update({ decisionValidUntil: new Date(Date.now() - 3_600_000) }, { where: { id: application } });

    await expect(harness.disburse(application)).rejects.toThrow('CREDIT_DECISION_EXPIRED');
  });

  it('dentro de las dos vigencias se desembolsa', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    await harness.createCreditLine(customerId, '1000.00');
    const application = await harness.createApprovedApplication({ customerId, amount: '100.00' });
    await CreditApplicationModel.update({ decisionValidUntil: new Date(Date.now() + 3_600_000) }, { where: { id: application } });

    await expect(harness.disburse(application)).resolves.toEqual(expect.objectContaining({ status: 'active' }));
  });
});

describe('P-09 · una solicitud diferida se decide sola cuando la base llega (PostgreSQL real)', () => {
  it('queda submitted con el motivo, y el reintento la aprueba y guarda la vigencia del motor', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer();
    const now = new Date();
    const created = await CreditApplicationModel.create({
      tenantId: harness.tenantId,
      applicationCode: `APP-${randomUUID().slice(0, 8)}`,
      customerId,
      creditProductId: harness.productId,
      requestedAmount: '80.00',
      requestedTermMonths: 3,
      currencyCode: 'BOB',
      status: 'submitted',
      eligibilitySnapshotJson: {},
      submittedAt: now,
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    } as never);
    const validUntil = new Date(Date.now() + 3_600_000);
    const outcomes = [
      { kind: 'deferred', reason: DEFERRED_BASIS_REASON },
      {
        kind: 'approved',
        response: {
          executionId: '88001',
          status: 'SUCCEEDED',
          outcome: 'APPROVE',
          reasonCodes: [],
          decisionValidUntil: validUntil.toISOString(),
        },
      },
    ];
    let call = 0;
    const decider = { decide: async () => ({ outcome: outcomes[call++], subjectReference: 'subj-1', excludedFeatures: [] }) };
    const underwriting = new CreditUnderwritingService(decider as never, harness.creditRepository, harness.sequelize as never);
    const input = {
      tenantId: harness.tenantId,
      applicationId: String(created.id),
      customerId,
      applicationCode: created.applicationCode,
      requestedAmount: '80.00',
      requestedTermMonths: 3,
      currencyCode: 'BOB',
      productCode: null,
      purposeCode: null,
    };

    expect((await underwriting.underwrite(input)).status).toBe('submitted');
    const deferred = await CreditApplicationModel.findByPk(created.id);
    expect(deferred).toMatchObject({ status: 'submitted', decisionReasonCode: DEFERRED_BASIS_REASON, decidedAt: null });

    const summary = await underwriting.retryDeferred({ tenantId: harness.tenantId, limit: 50, maxAgeHours: 72 });
    expect(summary).toMatchObject({ candidates: 1, decided: 1 });
    const decided = await CreditApplicationModel.findByPk(created.id);
    expect(decided?.status).toBe('approved');
    expect(decided?.decisionValidUntil?.getTime()).toBe(validUntil.getTime());
  });
});
