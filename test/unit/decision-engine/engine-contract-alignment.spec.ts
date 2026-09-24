/**
 * @file P-09/P-10/P-11 — piezas puras y el gateway de la base habilitante frente al contrato del motor.
 * @business La base se registra una vez y con fecha estable; un 409 de réplica superada no se reintenta;
 *   las fechas de las variables nunca se inventan; las filas del motor se leen como el motor las manda.
 * @system `EngineConsentGateway.ensureGranted`, `classifyDecision`, `buildVariableMetadata`,
 *   `lineVariableMetadata`, `parseFacility*` y el catálogo de trabajos.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { lineVariableMetadata } from '../../../src/modules/decision-engine/underwriting-features.service.js';
import { featureMetadata } from '../../../src/modules/decision-engine/credit-decision-engine.service.js';
import type { DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';
import { classifyDecision } from '../../../src/modules/decision-engine/decision-verdict.js';
import { EngineConsentGateway } from '../../../src/modules/decision-engine/engine-consent.gateway.js';
import { engineErrorCode, engineErrorStatus } from '../../../src/modules/decision-engine/engine-transport.service.js';
import { parseFacilityOutcomes, parseFacilityRegistrations } from '../../../src/modules/decision-engine/engine-verdicts.js';
import { basisBlocker } from '../../../src/modules/decision-engine/underwriting-basis.js';
import { buildVariableMetadata } from '../../../src/modules/decision-engine/variable-metadata.js';
import { buildScheduledJobs } from '../../../src/modules/runtime-jobs/scheduled-jobs.catalog.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('P-09 · EngineConsentGateway.ensureGranted', () => {
  const savedGovernance = env.DECISION_ENGINE_GOVERNANCE_API_KEY;
  beforeEach(() => {
    (env as unknown as Record<string, unknown>).DECISION_ENGINE_GOVERNANCE_API_KEY = 'llave-gobierno';
  });
  afterEach(() => {
    (env as unknown as Record<string, unknown>).DECISION_ENGINE_GOVERNANCE_API_KEY = savedGovernance;
  });

  function build(
    current: Record<string, unknown> | null,
    call: (...args: unknown[]) => Promise<unknown> = async () => ({ status: 200, json: {} }),
  ) {
    const transport = { baseUrl: () => 'http://motor', call: jest.fn(call) };
    const store = {
      findCurrent: jest.fn(async (..._args: unknown[]) => current),
      request: jest.fn(async (..._args: unknown[]) => ({ id: 'r1', requestedAt: NOW })),
      markSynced: jest.fn(async (..._args: unknown[]) => true),
      markSuperseded: jest.fn(async (..._args: unknown[]) => true),
      markFailed: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const gateway = new EngineConsentGateway(transport as never, () => true, store as never);
    const ensure = () =>
      gateway.ensureGranted({
        tenantId: '1',
        customerId: '24',
        subjectReference: 'subj-1',
        purpose: 'credit_underwriting',
        basis: 'CREDIT_PROTECTION',
        now: NOW,
      });
    return { transport, store, ensure };
  }

  it('la primera vez escribe la base en la cola, la entrega y queda lista con marca = fecha de alta', async () => {
    const { transport, store, ensure } = build(null);
    await expect(ensure()).resolves.toEqual({ status: 'ready', marker: String(NOW.getTime()) });
    expect(store.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'grant', basis: 'CREDIT_PROTECTION', grantedAt: NOW }));
    expect(transport.call).toHaveBeenCalledWith(
      'http://motor/v1/risk-governance/consents',
      'llave-gobierno',
      expect.objectContaining({ basis: 'CREDIT_PROTECTION', grantedAt: NOW.toISOString(), purpose: 'credit_underwriting' }),
    );
    expect(store.markSynced).toHaveBeenCalled();
  });

  it('ya acusada con la misma base: no vuelve a llamar al motor', async () => {
    const granted = new Date('2026-09-01T00:00:00.000Z');
    const { transport, ensure } = build({
      action: 'grant',
      status: 'synced',
      basis: 'CREDIT_PROTECTION',
      consentVersion: null,
      grantedAt: granted,
    });
    await expect(ensure()).resolves.toEqual({ status: 'ready', marker: String(granted.getTime()) });
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('pendiente de antes: reintenta con la MISMA fecha de alta (una fecha nueva sería otra alta)', async () => {
    const granted = new Date('2026-09-01T00:00:00.000Z');
    const { store, ensure } = build({
      action: 'grant',
      status: 'pending',
      basis: 'CREDIT_PROTECTION',
      consentVersion: null,
      grantedAt: granted,
    });
    await ensure();
    expect(store.request).toHaveBeenCalledWith(expect.objectContaining({ grantedAt: granted }));
  });

  it('409 CONSENT_GRANT_REPLAYED: resuelta como superada, se puede decidir y el motor juzga', async () => {
    const replayed = Object.assign(new Error('HTTP 409'), { httpStatus: 409, cause: { error: { code: 'CONSENT_GRANT_REPLAYED' } } });
    const { store, ensure } = build(null, async () => {
      throw replayed;
    });
    const readiness = await ensure();
    expect(readiness.status).toBe('superseded');
    expect(basisBlocker(readiness)).toBeNull();
    expect(store.markSuperseded).toHaveBeenCalledWith({ id: 'r1', requestedAt: NOW }, 'CONSENT_GRANT_REPLAYED', expect.any(Date));
  });

  it('ya superada antes: no insiste', async () => {
    const { transport, ensure } = build({
      action: 'grant',
      status: 'superseded',
      basis: 'CREDIT_PROTECTION',
      consentVersion: null,
      grantedAt: NOW,
    });
    expect((await ensure()).status).toBe('superseded');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('motor caído: pendiente y diferida', async () => {
    const { store, ensure } = build(null, async () => {
      throw new Error('ECONNREFUSED');
    });
    const readiness = await ensure();
    expect(readiness).toMatchObject({ status: 'pending', marker: null });
    expect(basisBlocker(readiness)).toEqual({ kind: 'deferred', reason: 'ENABLING_BASIS_NOT_REPLICATED' });
    expect(store.markFailed).toHaveBeenCalled();
  });

  it('motor ANTERIOR (404 SUBJECT_NOT_FOUND): se decide como antes y la réplica queda pendiente', async () => {
    const legacy = Object.assign(new Error('HTTP 404'), { httpStatus: 404, cause: { error: { code: 'SUBJECT_NOT_FOUND' } } });
    const { store, ensure } = build(null, async () => {
      throw legacy;
    });
    const readiness = await ensure();
    expect(readiness).toMatchObject({ status: 'unmaterialized', marker: `u${NOW.getTime()}` });
    expect(basisBlocker(readiness)).toBeNull();
    expect(store.markFailed).toHaveBeenCalled();
    expect(store.markSuperseded).not.toHaveBeenCalled();
  });

  it('Core pidió revocar la finalidad: no se decide (revisión humana)', async () => {
    const { transport, ensure } = build({ action: 'revoke', status: 'pending' });
    const readiness = await ensure();
    expect(readiness.status).toBe('revoked');
    expect(basisBlocker(readiness)).toEqual({ kind: 'engineUnavailable', reason: 'ENABLING_BASIS_REVOKED' });
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('la cola rechaza el alta por una revocación posterior: revocada', async () => {
    const { store, ensure } = build(null);
    store.request.mockResolvedValueOnce(null as never);
    expect((await ensure()).status).toBe('revoked');
  });

  it('sin motor configurado: pendiente, sin llamar', async () => {
    const transport = { baseUrl: () => 'http://motor', call: jest.fn() };
    const store = { findCurrent: async () => null, request: async () => ({ id: 'r1', requestedAt: NOW }) };
    const gateway = new EngineConsentGateway(transport as never, () => false, store as never);
    const readiness = await gateway.ensureGranted({
      tenantId: '1',
      customerId: '24',
      subjectReference: 's',
      purpose: 'credit_underwriting',
      basis: 'CREDIT_PROTECTION',
      now: NOW,
    });
    expect(readiness).toMatchObject({ status: 'pending', error: 'DECISION_ENGINE_NOT_CONFIGURED' });
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('lee el código y el status de un error del motor', () => {
    expect(engineErrorCode({ cause: { error: { code: 'X' } } })).toBe('X');
    expect(engineErrorCode({ cause: { title: 'Y' } })).toBe('Y');
    expect(engineErrorCode(new Error('plain'))).toBeNull();
    expect(engineErrorCode(null)).toBeNull();
    expect(engineErrorStatus({ httpStatus: 409 })).toBe(409);
    expect(engineErrorStatus({})).toBeNull();
  });
});

describe('P-10 · classifyDecision con los campos nuevos del motor', () => {
  const approve = (overrides: Record<string, unknown> = {}) =>
    ({ executionId: 'e', status: 'SUCCEEDED', outcome: 'APPROVE', reasonCodes: [], ...overrides }) as DecisionResponse;

  it.each([
    ['freshnessUnknown vacío → aprueba', approve({ freshnessUnknown: [] }), 'approved'],
    ['freshnessUnknown con una crítica → revisión técnica', approve({ freshnessUnknown: ['declared_monthly_income'] }), 'review'],
    ['degradedInputs → revisión', approve({ degradedInputs: true }), 'review'],
    ['exposición negativa tras decidir → revisión', approve({ exposure: { remainingAfterDecision: -1 } }), 'review'],
    ['exposición justa → aprueba', approve({ exposure: { remainingAfterDecision: 0 } }), 'approved'],
    ['motivo ENABLING_BASIS_* en una aprobación → revisión', approve({ reasonCodes: [{ code: 'ENABLING_BASIS_EXPIRED' }] }), 'review'],
    [
      'DECLINE con frescura desconocida se respeta como rechazo (no concede)',
      approve({ outcome: 'DECLINE', freshnessUnknown: ['x'] }),
      'declined',
    ],
  ])('%s', (_name, input, expected) => {
    expect(classifyDecision(input).kind).toBe(expected);
  });

  it('NO_DECISION sin código técnico conocido sigue siendo revisión técnica', () => {
    expect(classifyDecision(approve({ status: 'FAILED', reasonCodes: [] }))).toEqual({
      kind: 'review',
      reason: 'STATUS_NOT_COMPLETED:FAILED',
      technical: true,
    });
  });
});

describe('P-10 · variableMetadata: sólo fechas conocidas', () => {
  it('pedido y libro en vivo con fecha de ahora; declarado con su captura; ausente sin fecha', () => {
    const metadata = buildVariableMetadata({
      now: NOW,
      provenance: {
        declared_monthly_income: 'expediente',
        delinquency_count_12m: 'expediente',
        bureau_score: 'ausente',
        kyc_status: 'expediente',
        age: 'ausente',
      },
      economyObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      identityObservedAt: null,
    });
    expect(metadata.requested_amount).toEqual({ observedAt: NOW.toISOString() });
    expect(metadata.delinquency_count_12m).toEqual({ observedAt: NOW.toISOString(), fetchedAt: NOW.toISOString() });
    // Declarado: su captura y NUNCA «obtenido ahora», que el motor tomaría por fresco.
    expect(metadata.declared_monthly_income).toEqual({ observedAt: '2026-08-01T00:00:00.000Z' });
    expect(metadata.bureau_score).toBeUndefined();
    expect(metadata.age).toBeUndefined();
    // Identidad sin fecha conocida: no se inventa.
    expect(metadata.kyc_status).toBeUndefined();
  });

  it('las fechas propias pisan a las de grupo y una fecha inválida se descarta', () => {
    const metadata = buildVariableMetadata({
      now: NOW,
      provenance: {},
      economyObservedAt: new Date('invalid'),
      identityObservedAt: null,
      observed: { ingresos: new Date('2026-07-01T00:00:00.000Z'), roto: new Date('x'), nulo: null },
    });
    expect(metadata.ingresos).toEqual({ observedAt: '2026-07-01T00:00:00.000Z' });
    expect(metadata.roto).toBeUndefined();
    expect(metadata.nulo).toBeUndefined();
  });

  it('el feature store se fecha desde que su valor vale', () => {
    expect(
      featureMetadata([
        { featureCode: 'f1', observedAt: new Date('2026-06-01T00:00:00.000Z') },
        { featureCode: 'f2', observedAt: null },
      ]),
    ).toEqual({
      f1: { observedAt: '2026-06-01T00:00:00.000Z' },
    });
  });

  it('recálculo de línea: capacidad por extracto SIN fecha, por declarado con la captura económica', () => {
    const features = {
      variables: {},
      provenance: {},
      variableMetadata: { requested_amount: { observedAt: NOW.toISOString() } },
      observedAt: { economy: new Date('2026-08-01T00:00:00.000Z'), identity: null },
    };
    const extracto = lineVariableMetadata(features, 'EXTRACTO');
    expect(extracto.capacity_recommended_limit).toBeUndefined();
    expect(extracto.tenure_score).toEqual({ observedAt: NOW.toISOString(), fetchedAt: NOW.toISOString() });
    expect(lineVariableMetadata(features, 'DECLARADO').capacity_recommended_limit).toEqual({ observedAt: '2026-08-01T00:00:00.000Z' });
    expect(lineVariableMetadata({ ...features, variableMetadata: {} }, 'DECLARADO').tenure_score).toBeUndefined();
  });
});

describe('P-11 · filas del motor tal como el motor las manda (`rows`, `code`, `duplicate`)', () => {
  it('altas: accepted, duplicate y code', () => {
    expect(
      parseFacilityRegistrations({
        rows: [
          { externalReference: 'A', accepted: true, duplicate: true },
          { externalReference: 'B', accepted: false, code: 'FACILITY_REFERENCE_CONFLICT' },
        ],
      }),
    ).toEqual([
      { externalReference: 'A', accepted: true, reason: null, duplicate: true },
      { externalReference: 'B', accepted: false, reason: 'FACILITY_REFERENCE_CONFLICT', duplicate: false },
    ]);
  });

  it('desenlaces: OUTCOME_CONFLICT por fila, y `results` legado sigue leyéndose', () => {
    expect(
      parseFacilityOutcomes({ rows: [{ externalReference: 'A', windowDays: 90, accepted: false, code: 'OUTCOME_CONFLICT' }] }),
    ).toEqual([{ externalReference: 'A', windowDays: 90, accepted: false, reason: 'OUTCOME_CONFLICT', duplicate: false }]);
    expect(parseFacilityOutcomes({ results: [{ externalReference: 'A', windowDays: 90, status: 'RECORDED' }] })[0].accepted).toBe(true);
    expect(parseFacilityOutcomes({ text: '<html>' })).toEqual([]);
  });
});

describe('P-09 · el reintento de las diferidas corre solo', () => {
  it('el catálogo programa retry_deferred_underwriting cuando se le da el servicio', async () => {
    const retryDeferred = jest.fn(async (..._args: unknown[]) => ({ candidates: 0, decided: 0, stillDeferred: 0, failed: 0 }));
    const jobs = buildScheduledJobs({
      runtimeJobs: {} as never,
      maintenance: {} as never,
      onboardingAbandonment: {} as never,
      delinquency: {} as never,
      creditLineRefresh: {} as never,
      bankStatements: {} as never,
      supportSla: {} as never,
      debtRating: {} as never,
      outcomeDispatch: {} as never,
      partnerKybSync: {} as never,
      creditUnderwriting: { retryDeferred } as never,
      notificationCampaigns: { tick: async () => undefined },
      stressRuns: { drain: async () => undefined },
    });
    const job = jobs.find((entry) => entry.jobCode === 'retry_deferred_underwriting');
    expect(job).toBeDefined();
    await job?.run('7');
    expect(retryDeferred).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '7', maxAgeHours: env.CREDIT_DECISION_VALIDITY_HOURS }));
  });
});
