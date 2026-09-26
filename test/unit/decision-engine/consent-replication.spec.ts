import { describe, expect, it, jest } from '@jest/globals';
import { ConsentReplicationService } from '../../../src/modules/decision-engine/consent-replication.service.js';
import { ConsentReplicationStore, replicationBackoff } from '../../../src/modules/decision-engine/consent-replication.store.js';
import { EngineConsentGateway } from '../../../src/modules/decision-engine/engine-consent.gateway.js';
import { OutcomeDispatchService } from '../../../src/modules/decision-engine/outcome-dispatch.service.js';

/**
 * P-09 · la réplica duradera del consentimiento, con dobles. La cola real, la revocación con el motor
 * caído y el bloqueo del desembolso se miden contra PostgreSQL en
 * test/integration/credit/consent-enforcement.spec.ts.
 */
const NOW = new Date('2026-09-24T12:00:00.000Z');

function transport(up: boolean) {
  return {
    baseUrl: () => 'http://motor',
    call: jest.fn(async (..._args: unknown[]) => {
      if (!up) throw new Error('ECONNREFUSED');
      return { status: 200, json: {} };
    }),
  };
}

function fakeStore(requestResult: { id: string; requestedAt: Date } | null = { id: '1', requestedAt: NOW }) {
  return {
    request: jest.fn(async (..._args: unknown[]) => requestResult),
    markSynced: jest.fn(async (..._args: unknown[]) => true),
    markFailed: jest.fn(async (..._args: unknown[]) => undefined),
    enqueueMissingRevocations: jest.fn(async (..._args: unknown[]) => 2),
    listDue: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    summarize: jest.fn(async (..._args: unknown[]) => ({ pending: 1, pendingRevocations: 1, oldestPendingAt: NOW })),
  };
}

const grant = {
  tenantId: '1',
  customerId: '24',
  subjectReference: 's1',
  purpose: 'credit_underwriting',
  action: 'grant' as const,
  basis: 'CREDIT_PROTECTION' as const,
  grantedAt: NOW,
};

describe('EngineConsentGateway', () => {
  it('escribe la petición y la acusa al entregarla', async () => {
    const store = fakeStore();
    const gateway = new EngineConsentGateway(transport(true) as never, () => true, store as never);
    expect(await gateway.replicate(grant)).toBe(true);
    expect(store.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'grant', purposeCode: 'credit_underwriting' }));
    expect(store.markSynced).toHaveBeenCalledWith('1', NOW, expect.any(Date));
  });

  it('con el motor caído devuelve false, NO pierde la petición y la reprograma', async () => {
    const store = fakeStore();
    const gateway = new EngineConsentGateway(transport(false) as never, () => true, store as never);
    expect(await gateway.replicate({ ...grant, action: 'revoke', basis: null, grantedAt: null })).toBe(false);
    expect(store.markFailed).toHaveBeenCalledWith({ id: '1', attempts: 0, requestedAt: NOW }, 'ECONNREFUSED', expect.any(Date));
  });

  it('una petición superada por una revocación posterior no se entrega', async () => {
    const store = fakeStore(null);
    const http = transport(true);
    const gateway = new EngineConsentGateway(http as never, () => true, store as never);
    expect(await gateway.replicate(grant)).toBe(false);
    expect(http.call).not.toHaveBeenCalled();
  });

  it('sin motor configurado deja la petición pendiente y no llama', async () => {
    const store = fakeStore();
    const http = transport(true);
    expect(await new EngineConsentGateway(http as never, () => false, store as never).replicate(grant)).toBe(false);
    expect(store.request).toHaveBeenCalled();
    expect(http.call).not.toHaveBeenCalled();
  });

  it('sin cola (o sin a quién atribuirla) sigue siendo un intento simple', async () => {
    const http = transport(true);
    expect(await new EngineConsentGateway(http as never, () => true).replicate({ ...grant, tenantId: undefined })).toBe(true);
  });

  it('la revocación va al endpoint de revocar; el permiso, con su base y vigencia', async () => {
    const http = transport(true);
    const gateway = new EngineConsentGateway(http as never, () => true);
    await gateway.deliverConsent({ action: 'revoke', subjectReference: 's1', purpose: 'p' });
    await gateway.deliverConsent({
      action: 'grant',
      subjectReference: 's1',
      purpose: 'p',
      basis: 'CONSENT',
      grantedAt: NOW,
      expiresAt: NOW,
      evidenceRef: 'e',
    });
    expect(http.call.mock.calls[0]![0]).toBe('http://motor/v1/risk-governance/consents/revoke');
    expect(http.call.mock.calls[1]![2]).toEqual(
      expect.objectContaining({ basis: 'CONSENT', grantedAt: NOW.toISOString(), expiresAt: NOW.toISOString(), evidenceRef: 'e' }),
    );
  });
});

describe('ConsentReplicationService', () => {
  const row = {
    id: '7',
    action: 'revoke',
    subjectReference: 's1',
    purposeCode: 'p',
    basis: null,
    grantedAt: null,
    expiresAt: null,
    attempts: 0,
    requestedAt: NOW,
  };

  it('encola revocaciones sin réplica, entrega lo vencido y acusa', async () => {
    const store = fakeStore();
    store.listDue.mockResolvedValueOnce([row]);
    const client = { isConfigured: true, consents: { deliverConsent: jest.fn(async () => undefined) } };
    const result = await new ConsentReplicationService(client as never, store as never).sync({ tenantId: '1', limit: 10, now: NOW });
    expect(result).toMatchObject({ enqueued: 2, synced: 1, failed: 0 });
  });

  it('un fallo por fila no tumba la pasada: se reprograma esa fila', async () => {
    const store = fakeStore();
    store.listDue.mockResolvedValueOnce([row]);
    const client = {
      isConfigured: true,
      consents: { deliverConsent: jest.fn(async () => Promise.reject(new Error('SUBJECT_NOT_FOUND'))) },
    };
    const result = await new ConsentReplicationService(client as never, store as never).sync({ tenantId: null, limit: 10 });
    expect(result).toMatchObject({ synced: 0, failed: 1 });
    expect(store.markFailed).toHaveBeenCalledWith(row, 'SUBJECT_NOT_FOUND', expect.any(Date));
  });

  it('sin motor configurado no entrega nada y lo dice', async () => {
    const store = fakeStore();
    const result = await new ConsentReplicationService({ isConfigured: false } as never, store as never).sync({ tenantId: '1', limit: 10 });
    expect(result).toMatchObject({ reason: 'DECISION_ENGINE_NOT_CONFIGURED', pendingRevocations: 1 });
    expect(store.listDue).not.toHaveBeenCalled();
  });

  it('la fachada del despacho delega, y sin cola cableada no finge', async () => {
    const consents = { sync: jest.fn(async (..._args: unknown[]) => ({ enqueued: 0, synced: 0, failed: 0 })) };
    const wired = new OutcomeDispatchService({} as never, {} as never, {} as never, {} as never, consents as never);
    await wired.sincronizarConsentimientos({ tenantId: '1', limit: 5 });
    expect(consents.sync).toHaveBeenCalledWith({ tenantId: '1', limit: 5 });
    const bare = new OutcomeDispatchService({} as never, {} as never, {} as never, {} as never);
    expect(await bare.sincronizarConsentimientos({ tenantId: '1', limit: 5 })).toMatchObject({ reason: 'CONSENT_REPLICATION_NOT_WIRED' });
  });
});

describe('ConsentReplicationStore', () => {
  function store(queryRows: unknown[] = [], updated = 1) {
    const model = {
      update: jest.fn(async (..._args: unknown[]) => [updated]),
      findAll: jest.fn(async () => []),
      count: jest.fn(async () => 3),
      min: jest.fn(async () => NOW),
    };
    const sequelize = { query: jest.fn(async () => queryRows) };
    return { store: new ConsentReplicationStore(model as never, sequelize as never), model, sequelize };
  }

  it('request devuelve la fila escrita o null si quedó superada', async () => {
    expect(await store([{ id: '9', requested_at: NOW }]).store.request({ ...grant, purposeCode: 'p', now: NOW })).toEqual({
      id: '9',
      requestedAt: NOW,
    });
    expect(await store([]).store.request({ ...grant, purposeCode: 'p', now: NOW })).toBeNull();
  });

  it('markSynced sólo acusa la misma petición; markFailed suma intento y aplaza', async () => {
    const { store: s, model } = store([], 0);
    expect(await s.markSynced('9', NOW, NOW)).toBe(false);
    await s.markFailed({ id: '9', attempts: 2, requestedAt: NOW }, 'x', NOW);
    expect(model.update).toHaveBeenLastCalledWith(expect.objectContaining({ attempts: 3, nextAttemptAt: replicationBackoff(NOW, 3) }), {
      where: { id: '9', requestedAt: NOW, status: 'pending' },
    });
  });

  it('enqueue, listDue y summarize', async () => {
    const { store: s } = store([{ id: '1' }, { id: '2' }]);
    expect(await s.enqueueMissingRevocations({ tenantId: null, limit: 10, now: NOW })).toBe(2);
    expect(await s.listDue({ tenantId: '1', limit: 10, now: NOW })).toEqual([]);
    expect(await s.summarize('1')).toEqual({ pending: 3, pendingRevocations: 3, oldestPendingAt: NOW });
  });

  it('el aplazamiento crece y tiene techo de una hora', () => {
    expect(replicationBackoff(NOW, 1).getTime() - NOW.getTime()).toBe(60_000);
    expect(replicationBackoff(NOW, 20).getTime() - NOW.getTime()).toBe(3_600_000);
  });
});
