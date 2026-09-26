/**
 * @file P-09/P-10/P-11 — cómo aplica Core al expediente el contrato nuevo del motor.
 * @business Una solicitud sin base habilitante replicada queda SIN decidir y se reintenta sola; una
 *   revisión técnica tiene bandeja en Atlas; la vigencia que el motor pone a su aprobación se guarda.
 * @system `CreditUnderwritingService.underwrite`/`retryDeferred` con el motor y la base como dobles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditUnderwritingService, DEFERRED_BASIS_REASON } from '../../../src/modules/credit/application/credit-underwriting.service.js';
import { decisionExpiresAt } from '../../../src/modules/credit/application/exposure-reservation.service.js';
import type { DecisionOutcome, DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';

function response(overrides: Record<string, unknown> = {}): DecisionResponse {
  return { executionId: '88001', status: 'SUCCEEDED', outcome: 'APPROVE', reasonCodes: [], ...overrides } as DecisionResponse;
}

function build(outcomes: DecisionOutcome[], application: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'app-1',
    status: 'submitted',
    decisionReasonCode: null,
    customerId: 'c1',
    applicationCode: 'CRA-1',
    creditProductId: 'p1',
    requestedAmount: '80.00',
    requestedTermMonths: 3,
    currencyCode: 'BOB',
    purposeCode: null,
    save: jest.fn(),
    ...application,
  };
  let call = 0;
  const engine = {
    decide: jest.fn(async (..._args: unknown[]) => ({
      outcome: outcomes[Math.min(call++, outcomes.length - 1)],
      subjectReference: 'subj-1',
      excludedFeatures: [],
    })),
  };
  const credit = {
    findApplicationById: jest.fn(async (..._args: unknown[]) => row),
    createApplicationEvent: jest.fn(async (..._args: unknown[]) => ({})),
    findDeferredApplications: jest.fn(async (..._args: unknown[]) => [row]),
    findProductById: jest.fn(async (..._args: unknown[]) => ({ productCode: 'BNPL' })),
  };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
  const reviewCases = {
    open: jest.fn(async (values: Record<string, unknown>, _options?: unknown) => ({
      caseCode: `CR-${String(values.applicationCode)}`,
      customerId: values.customerId,
      status: 'open',
    })),
  };
  return {
    service: new CreditUnderwritingService(engine as never, credit as never, sequelize as never, reviewCases as never),
    row,
    credit,
    engine,
    reviewCases,
  };
}

const input = {
  tenantId: '1',
  applicationId: 'app-1',
  customerId: 'c1',
  applicationCode: 'CRA-1',
  requestedAmount: '80.00',
  requestedTermMonths: 3,
  currencyCode: 'BOB',
  productCode: 'BNPL',
  purposeCode: null,
};

describe('P-09 · base habilitante no replicada: diferida, nunca rechazada', () => {
  it('queda submitted, sin fecha de decisión, con el motivo del diferimiento y evento propio', async () => {
    const { service, row, credit } = build([{ kind: 'deferred', reason: DEFERRED_BASIS_REASON }]);
    const result = await service.underwrite(input);

    expect(result.status).toBe('submitted');
    expect(row).toMatchObject({
      status: 'submitted',
      decidedAt: null,
      decisionExecutionId: null,
      decisionReasonCode: DEFERRED_BASIS_REASON,
    });
    expect(credit.createApplicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'decision_deferred' }),
      expect.anything(),
    );
  });

  it('el reintento vuelve a pedir la decisión y la aplica cuando la base ya llegó', async () => {
    const { service, row, credit } = build([{ kind: 'approved', response: response() }]);
    row.decisionReasonCode = DEFERRED_BASIS_REASON;
    const now = new Date('2026-09-24T12:00:00.000Z');

    const summary = await service.retryDeferred({ tenantId: '1', limit: 10, maxAgeHours: 72, now });

    expect(summary).toEqual({ candidates: 1, decided: 1, stillDeferred: 0, failed: 0 });
    expect(row.status).toBe('approved');
    expect(credit.findDeferredApplications).toHaveBeenCalledWith({
      tenantId: '1',
      reasonCode: DEFERRED_BASIS_REASON,
      since: new Date('2026-09-21T12:00:00.000Z'),
      limit: 10,
    });
  });

  it('el reintento cuenta las que siguen diferidas y no se detiene por una que falla', async () => {
    const { service, engine } = build([{ kind: 'deferred', reason: DEFERRED_BASIS_REASON }]);
    expect(await service.retryDeferred({ tenantId: '1', limit: 10, maxAgeHours: 72 })).toMatchObject({ stillDeferred: 1 });
    engine.decide.mockRejectedValueOnce(new Error('boom') as never);
    expect(await service.retryDeferred({ tenantId: '1', limit: 10, maxAgeHours: 72 })).toMatchObject({ failed: 1 });
  });

  it('una respuesta tardía no pisa una solicitud que ya decidió una persona', async () => {
    const { service, row } = build([{ kind: 'approved', response: response() }], { status: 'rejected', decisionMode: 'manual' });
    const result = await service.underwrite(input);
    expect(result.status).toBe('rejected');
    expect(row.save).not.toHaveBeenCalled();
  });
});

describe('P-10 · 422 NO_DECISION = revisión técnica con bandeja en Atlas', () => {
  it('NO_DECISION técnico → under_review en la cola de Atlas, ni rechazo ni aprobación', async () => {
    const technical = response({
      status: 'NO_DECISION',
      outcome: 'NO_DECISION',
      reasonCodes: [{ code: 'ECONOMIC_OUTPUT_INVALID', category: 'TECHNICAL' }],
    });
    const { service, row } = build([
      { kind: 'review', response: technical, technical: true, reason: 'TECHNICAL_NO_DECISION:ECONOMIC_OUTPUT_INVALID' },
    ]);
    const result = await service.underwrite(input);

    expect(result.status).toBe('under_review');
    expect(result.decisionMode).toBe('engine_unavailable_manual');
    expect(row.businessAcceptance).toBeNull();
    expect(row.decisionValidUntil).toBeNull();
  });

  it('revisión con caso abierto EN el motor → se delega (decision_engine)', async () => {
    const { service } = build([{ kind: 'review', response: response({ outcome: 'REVIEW', manualReview: { caseCode: 'MR-1' } }) }]);
    expect((await service.underwrite(input)).decisionMode).toBe('decision_engine');
  });
});

describe('P-11 · vigencia de la aprobación', () => {
  it('guarda decisionValidUntil del motor en la aprobación', async () => {
    const { service, row } = build([{ kind: 'approved', response: response({ decisionValidUntil: '2026-09-24T13:00:00.000Z' }) }]);
    await service.underwrite(input);
    expect(row.decisionValidUntil).toEqual(new Date('2026-09-24T13:00:00.000Z'));
  });

  it('no concede después de min(decisionValidUntil, decidedAt + horas del core)', () => {
    const decidedAt = new Date('2026-09-24T12:00:00.000Z');
    expect(decisionExpiresAt(decidedAt, 72, new Date('2026-09-24T13:00:00.000Z'))).toEqual(new Date('2026-09-24T13:00:00.000Z'));
    expect(decisionExpiresAt(decidedAt, 1, new Date('2026-09-30T00:00:00.000Z'))).toEqual(new Date('2026-09-24T13:00:00.000Z'));
    expect(decisionExpiresAt(decidedAt, 72, null)).toEqual(new Date('2026-09-27T12:00:00.000Z'));
    expect(decisionExpiresAt(decidedAt, 72, new Date('invalid'))).toEqual(new Date('2026-09-27T12:00:00.000Z'));
    expect(decisionExpiresAt(null, 72, new Date('2026-09-30T00:00:00.000Z'))).toEqual(new Date(0));
  });
});
