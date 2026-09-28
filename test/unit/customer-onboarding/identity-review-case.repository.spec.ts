/**
 * @file Fija el caso `identity_review` de la bandeja de operaciones.
 * @business Un cliente cuya identidad espera a una persona tiene que aparecer en la bandeja de alguien, una sola vez.
 * @system Ejercita IdentityReviewCaseRepository contra un modelo simulado.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { IdentityReviewCaseRepository } from '../../../src/modules/customer-onboarding/repositories/identity-review-case.repository.js';

function build(existing: unknown = null) {
  const model = {
    findOne: jest.fn(async (..._args: unknown[]) => existing),
    create: jest.fn(async (...args: unknown[]) => args[0]),
    update: jest.fn(async (..._args: unknown[]) => [2]),
  };
  return { repository: new IdentityReviewCaseRepository(model as never), model };
}

const now = new Date('2026-09-28T12:00:00Z');

describe('IdentityReviewCaseRepository', () => {
  it('abre un caso identity_review abierto, sin corrida de riesgo ni ejecución del Motor', async () => {
    const { repository, model } = build();
    await repository.openIfAbsent({ tenantId: '1', customerId: '77', notes: 'El Motor sugiere VERIFIED', now });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        customerId: '77',
        caseType: 'identity_review',
        status: 'open',
        riskAssessmentRunId: null,
        decisionExecutionId: null,
        closedAt: null,
      }),
      expect.anything(),
    );
  });

  it('no duplica: con uno abierto para el cliente, devuelve ése', async () => {
    const abierto = { id: '9', caseType: 'identity_review' };
    const { repository, model } = build(abierto);
    await expect(repository.openIfAbsent({ tenantId: '1', customerId: '77', notes: 'x', now })).resolves.toBe(abierto);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('cierra los casos abiertos del cliente con la resolución de la persona', async () => {
    const { repository, model } = build();
    await expect(repository.closeOpen({ tenantId: '1', customerId: '77', resolution: 'approved', notes: null, now })).resolves.toBe(2);
    expect(model.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed', closedAt: now, resolution: 'approved' }),
      expect.objectContaining({ where: expect.objectContaining({ tenantId: '1', customerId: '77', caseType: 'identity_review' }) }),
    );
  });
});
