/**
 * @file P-10 — el core sólo concede con una aprobación completa, reconocida y limpia del motor.
 * @business Estado técnico inválido, dato crítico desconocido, revisión pendiente o un valor que el
 *   core no reconoce: ninguno concede. Un bug del artefacto tampoco recorta la línea del cliente.
 * @system `classifyDecision` (tabla), `CreditDecisionEngineService.decide` con un motor doble y
 *   `usableLimit` del recálculo de línea. El desembolso exige `approved` (loan-disbursement.service.spec).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { usableLimit } from '../../../src/modules/credit/application/credit-line-recalculation.service.js';
import { CreditDecisionEngineService } from '../../../src/modules/decision-engine/credit-decision-engine.service.js';
import type { DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';
import { classifyDecision } from '../../../src/modules/decision-engine/decision-verdict.js';

function response(overrides: Record<string, unknown> = {}): DecisionResponse {
  return {
    executionId: 'exec-1',
    status: 'SUCCEEDED',
    outcome: 'APPROVE',
    reasonCodes: [],
    ...overrides,
  } as DecisionResponse;
}

describe('P-10 · classifyDecision falla cerrado', () => {
  it.each([
    ['SUCCEEDED + APPROVE limpia', response(), 'approved'],
    ['COMPLETED + APPROVED', response({ status: 'COMPLETED', outcome: 'APPROVED' }), 'approved'],
    ['SUCCEEDED + DECLINE', response({ outcome: 'DECLINE' }), 'declined'],
    ['NO_DECISION aunque diga APPROVE', response({ status: 'NO_DECISION' }), 'review'],
    ['FAILED', response({ status: 'FAILED', outcome: null }), 'review'],
    ['estado técnico aditivo desconocido', response({ status: 'TECHNICAL_REVIEW' }), 'review'],
    ['estado vacío', response({ status: '' }), 'review'],
    ['desenlace desconocido (APPROVE_WITH_CONDITIONS)', response({ outcome: 'APPROVE_WITH_CONDITIONS' }), 'review'],
    ['desenlace ausente', response({ outcome: null }), 'review'],
    ['REVIEW explícito', response({ outcome: 'REVIEW' }), 'review'],
    ['aprobación con caso de revisión abierto', response({ manualReview: { caseCode: 'MR-1' } }), 'review'],
    [
      'aprobación con motivo técnico (salida económica inválida)',
      response({ reasonCodes: [{ code: 'PD_OUT_OF_RANGE', category: 'TECHNICAL' }] }),
      'review',
    ],
    ['aprobación con frescura desconocida', response({ reasonCodes: [{ code: 'FRESHNESS_UNKNOWN' }] }), 'review'],
    ['aprobación con dato crítico desconocido', response({ criticalDataUnknown: true }), 'review'],
    ['aprobación con bandera de revisión técnica', response({ technicalReview: true }), 'review'],
  ])('%s → %s', (_name, input, expected) => {
    expect(classifyDecision(input).kind).toBe(expected);
  });
});

describe('P-10 · CreditDecisionEngineService sólo aprueba lo que classifyDecision aprueba', () => {
  function service(engineResponse: DecisionResponse) {
    const client = { isConfigured: true, execute: jest.fn(async () => engineResponse) };
    const span = { setAttribute: () => undefined, addEvent: () => undefined };
    return new CreditDecisionEngineService(
      { runInSpan: (_name: string, _attrs: unknown, fn: (s: unknown) => unknown) => fn(span) } as never,
      client as never,
      { projectForCustomer: async () => ({ variables: {}, lineage: [], excluded: [] }) } as never,
      { build: async () => ({ variables: {}, provenance: {} }) } as never,
      { register: async () => 'subject-ref' } as never,
      { resolve: async () => ({ artifactCode: 'credit_v1' }) } as never,
    );
  }
  const request = {
    tenantId: '1',
    customerId: '24',
    applicationId: '5',
    applicationCode: 'APP-5',
    requestedAmount: '80.00',
    requestedTermMonths: 3,
    currencyCode: 'BOB',
    productCode: null,
    purposeCode: null,
  };

  it('una ejecución NO_DECISION con APPROVE no concede: revisión', async () => {
    const result = await service(response({ status: 'NO_DECISION' })).decide(request);
    expect(result.outcome.kind).toBe('review');
  });

  it('un APPROVE con motivo técnico no concede: revisión', async () => {
    const result = await service(response({ reasonCodes: [{ code: 'OUTPUT_INVALID', category: 'TECHNICAL' }] })).decide(request);
    expect(result.outcome.kind).toBe('review');
  });

  it('una aprobación limpia sí concede', async () => {
    const result = await service(response()).decide(request);
    expect(result.outcome.kind).toBe('approved');
  });
});

describe('P-10 · usableLimit del recálculo de línea', () => {
  it('aprobación limpia → escribe el límite emitido', () => {
    expect(usableLimit(response(), { approved_credit_limit: 1500 })).toEqual({ write: true, approvedLimit: 1500 });
  });

  it('rechazo → escribe cero (lo que la política dijo)', () => {
    expect(usableLimit(response({ outcome: 'DECLINE' }), { approved_credit_limit: 1500 })).toEqual({ write: true, approvedLimit: 0 });
  });

  it.each([
    ['revisión técnica', response({ status: 'NO_DECISION' }), { approved_credit_limit: 1500 }],
    ['límite negativo', response(), { approved_credit_limit: -10 }],
    ['límite no finito', response(), { approved_credit_limit: 'Infinity' }],
    ['límite ausente', response(), {}],
  ])('%s → NO toca la línea vigente', (_name, input, output) => {
    expect(usableLimit(input, output as Record<string, unknown>).write).toBe(false);
  });
});
