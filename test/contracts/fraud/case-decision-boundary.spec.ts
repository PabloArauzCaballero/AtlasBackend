/**
 * @file AT-029 — resolver un caso exige permiso, motivo y revisión; ninguna lectura autoriza escritura.
 * @business Dos resoluciones incompatibles: una gana y la otra recibe conflicto; un operador sin permiso
 *   no muta ni ve caso ajeno; el estado de fraude es un valor con revisión.
 * @system Reglas puras del contrato (`checkResolution`); el dueño (`FraudService`) conserva la persistencia.
 */
import { describe, expect, it } from '@jest/globals';
import {
  FRAUD_RESOLVE_PERMISSION,
  checkResolution,
  type FraudResolutionCommand,
  type FraudStatus,
} from '../../../src/modules/fraud/public/fraud-status.contracts.js';

const base: FraudResolutionCommand = {
  tenantId: '1',
  caseId: '10',
  expectedRevision: 'r5',
  decision: 'cleared',
  reasonCode: null,
  actor: { type: 'internal_user', internalUserId: 'u1', permissions: [FRAUD_RESOLVE_PERMISSION] },
  commandKey: 'k',
};

describe('frontera de decisión de casos (AT-029)', () => {
  it('dos resoluciones incompatibles sobre la misma revisión: la primera gana, la segunda recibe conflicto', () => {
    let current = { revision: 'r5', closed: false };
    expect(checkResolution(base, current)).toEqual({ allowed: true });
    current = { revision: 'r6', closed: true }; // la primera cerró el caso y avanzó la revisión
    expect(checkResolution({ ...base, decision: 'confirmed_fraud', reasonCode: 'x' }, current)).toEqual({
      allowed: false,
      code: 'CASE_ALREADY_CLOSED',
    });
    expect(checkResolution({ ...base, expectedRevision: 'r5' }, { revision: 'r6', closed: false })).toEqual({
      allowed: false,
      code: 'FRAUD_CASE_REVISION_CONFLICT',
    });
  });

  it('operador sin permiso: sin mutación', () => {
    expect(checkResolution({ ...base, actor: { ...base.actor, permissions: [] } }, { revision: 'r5', closed: false })).toEqual({
      allowed: false,
      code: 'FRAUD_PERMISSION_DENIED',
    });
  });

  it('confirmar fraude o bloquear exige motivo (misma regla que FraudService)', () => {
    expect(checkResolution({ ...base, decision: 'blocked' }, { revision: 'r5', closed: false })).toEqual({
      allowed: false,
      code: 'FRAUD_REASON_REQUIRED',
    });
    expect(checkResolution({ ...base, decision: 'blocked', reasonCode: 'identity_mismatch' }, { revision: 'r5', closed: false })).toEqual({
      allowed: true,
    });
  });

  it('el estado de fraude es un valor con revisión y sin datos del caso', () => {
    const status: FraudStatus = {
      tenantId: '1',
      customerId: 'c',
      openCases: 1,
      highestSeverity: 'high',
      revision: '10',
      readAt: '2026-09-11T00:00:00.000Z',
    };
    expect(Object.keys(status).sort()).toEqual(['customerId', 'highestSeverity', 'openCases', 'readAt', 'revision', 'tenantId']);
  });
});
