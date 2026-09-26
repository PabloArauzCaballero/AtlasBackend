/**
 * @file P-14 — conformidad de Core con `POST /v1/risk-governance/consents` y `/consents/revoke`.
 * @business Una revocación llega con la fecha en que el titular revocó; un 409 de réplica superada se
 *   resuelve y no se reintenta para siempre; un fallo transitorio queda pendiente, nunca perdido.
 * @system gateway y reintentador REALES contra un motor doble HTTP; la cola duradera es un doble que
 *   registra qué acuse, fallo o resolución se escribió.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { ConsentReplicationService } from '../../../src/modules/decision-engine/consent-replication.service.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { EngineTransportService } from '../../../src/modules/decision-engine/engine-transport.service.js';
import { EngineDouble, pointCoreAt, problem, requestSchema, validate } from './support/engine-contract.js';

const CONSENTS = '/v1/risk-governance/consents';
const REVOKE = '/v1/risk-governance/consents/revoke';

let engine: EngineDouble;
let restoreEnv: () => void;
let baseUrl: string;

beforeAll(async () => {
  engine = new EngineDouble();
  baseUrl = await engine.start();
});

afterAll(async () => {
  await engine.stop();
});

beforeEach(() => {
  engine.requests.length = 0;
  restoreEnv = pointCoreAt(baseUrl);
});

afterEach(() => {
  restoreEnv();
  jest.restoreAllMocks();
});

/** La cola duradera, doble: sólo interesa qué se escribió en ella. */
function queue(rows: Array<Record<string, unknown>> = []) {
  return {
    request: jest.fn(async (..._args: unknown[]) => ({ id: 'r1', requestedAt: new Date('2026-09-20T10:00:00.000Z') })),
    findCurrent: jest.fn(async (..._args: unknown[]) => null),
    markSynced: jest.fn(async (..._args: unknown[]) => true),
    markFailed: jest.fn(async (..._args: unknown[]) => undefined),
    markSuperseded: jest.fn(async (..._args: unknown[]) => true),
    enqueueMissingRevocations: jest.fn(async (..._args: unknown[]) => 0),
    listDue: jest.fn(async (..._args: unknown[]) => rows),
    summarize: jest.fn(async (..._args: unknown[]) => ({ pending: 0, pendingRevocations: 0, oldestPendingAt: null })),
  };
}

function realClient(store: ReturnType<typeof queue>) {
  const client = new DecisionEngineClient(new EngineTransportService(new ResilientAdapterExecutorService()), store as never);
  return { client, sync: new ConsentReplicationService(client, store as never) };
}

const revocation = {
  id: 'r7',
  action: 'revoke' as const,
  subjectReference: 'subj-1',
  purposeCode: 'credit_bureau_query',
  basis: null,
  grantedAt: null,
  expiresAt: null,
  consentVersion: null,
  attempts: 0,
  requestedAt: new Date('2026-09-20T10:00:00.000Z'),
};

describe('P-14 · alta de base habilitante', () => {
  it('el cuerpo cumple RecordConsentDto, lleva la versión si la hay y va con la llave de gobierno', async () => {
    engine.reply(CONSENTS, { status: 200, body: { id: '31' } });
    const store = queue();
    const ok = await realClient(store).client.recordConsent({
      tenantId: '1',
      customerId: '24',
      subjectReference: 'subj-1',
      purpose: 'credit_bureau_query',
      basis: 'CONSENT',
      grantedAt: new Date('2026-09-01T00:00:00.000Z'),
      consentVersion: 'v1',
    });

    expect(ok).toBe(true);
    const [call] = engine.callsTo(CONSENTS);
    expect(validate(requestSchema(CONSENTS), call.body)).toEqual([]);
    expect(call.body).toMatchObject({ basis: 'CONSENT', grantedAt: '2026-09-01T00:00:00.000Z', consentVersion: 'v1' });
    expect(call.headers['x-api-key']).toBe('llave-gobierno');
    expect(store.markSynced).toHaveBeenCalled();
  });

  it('409 CONSENT_GRANT_REPLAYED es terminal: una llamada, réplica resuelta con ese motivo', async () => {
    engine.reply(CONSENTS, { status: 409, body: problem(409, 'CONSENT_GRANT_REPLAYED') });
    const store = queue();
    const ok = await realClient(store).client.recordConsent({
      tenantId: '1',
      customerId: '24',
      subjectReference: 'subj-1',
      purpose: 'credit_underwriting',
      basis: 'CREDIT_PROTECTION',
      grantedAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(ok).toBe(false);
    expect(engine.callsTo(CONSENTS)).toHaveLength(1);
    expect(store.markSuperseded).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'CONSENT_GRANT_REPLAYED', expect.any(Date));
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it.each([
    [401, 1],
    [403, 1],
    [429, 2],
    [500, 2],
  ])('HTTP %i: queda pendiente para reintento (%i llamadas), no resuelta', async (status, calls) => {
    engine.reply(CONSENTS, { status, body: problem(status, `E${status}`) });
    const store = queue();
    await realClient(store).client.recordConsent({
      tenantId: '1',
      customerId: '24',
      subjectReference: 'subj-1',
      purpose: 'credit_underwriting',
      basis: 'CREDIT_PROTECTION',
      grantedAt: new Date(),
    });
    expect(engine.callsTo(CONSENTS)).toHaveLength(calls);
    expect(store.markFailed).toHaveBeenCalled();
    expect(store.markSuperseded).not.toHaveBeenCalled();
  });
});

describe('P-14 · revocación', () => {
  it('se envía SIEMPRE con la fecha real de la revocación y cumple RevokeConsentDto', async () => {
    engine.reply(REVOKE, { status: 200, body: { id: '32' } });
    const store = queue([revocation]);
    const result = await realClient(store).sync.sync({ tenantId: '1', limit: 10 });

    const [call] = engine.callsTo(REVOKE);
    expect(validate(requestSchema(REVOKE), call.body)).toEqual([]);
    expect(call.body).toEqual({ subjectReference: 'subj-1', purpose: 'credit_bureau_query', revokedAt: '2026-09-20T10:00:00.000Z' });
    expect(result.synced).toBe(1);
  });

  it('la revocación de negocio lleva la fecha que se le da, no la de la entrega', async () => {
    engine.reply(REVOKE, { status: 200, body: { id: '32' } });
    const store = queue();
    const revokedAt = new Date(Date.now() - 3_600_000);
    await realClient(store).client.revokeConsent({
      tenantId: '1',
      customerId: '24',
      subjectReference: 'subj-1',
      purpose: 'credit_bureau_query',
      revokedAt,
    });
    expect(engine.callsTo(REVOKE)[0].body.revokedAt).toBe(revokedAt.toISOString());
  });

  it('409 CONSENT_REVOCATION_STALE en el reintentador: resuelta, no fallida ni reintentada', async () => {
    engine.reply(REVOKE, { status: 409, body: problem(409, 'CONSENT_REVOCATION_STALE') });
    const store = queue([revocation]);
    const result = await realClient(store).sync.sync({ tenantId: '1', limit: 10 });

    expect(result).toMatchObject({ synced: 0, failed: 0, superseded: 1 });
    expect(engine.callsTo(REVOKE)).toHaveLength(1);
    expect(store.markSuperseded).toHaveBeenCalledWith(revocation, 'CONSENT_REVOCATION_STALE', expect.any(Date));
  });

  it('un 409 que NO es de réplica superada sigue pendiente (no se da por resuelto)', async () => {
    engine.reply(REVOKE, { status: 409, body: problem(409, 'SOMETHING_ELSE') });
    const store = queue([revocation]);
    const result = await realClient(store).sync.sync({ tenantId: '1', limit: 10 });
    expect(result).toMatchObject({ failed: 1, superseded: 0 });
    expect(store.markFailed).toHaveBeenCalled();
  });

  it('timeout del motor: la revocación queda pendiente', async () => {
    engine.reply(REVOKE, { status: 200, body: { id: '32' }, delayMs: 1_000 });
    const store = queue([revocation]);
    const result = await realClient(store).sync.sync({ tenantId: '1', limit: 10 });
    expect(result.failed).toBe(1);
    expect(store.markSynced).not.toHaveBeenCalled();
  });
});
