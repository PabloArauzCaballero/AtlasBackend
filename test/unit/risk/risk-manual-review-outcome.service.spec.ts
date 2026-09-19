import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { RiskManualReviewOutcomeService } from '../../../src/modules/risk/application/risk-manual-review-outcome.service.js';

/**
 * La revisión de riesgo resuelta EN el Motor vuelve y mueve al cliente.
 *
 * Antes el caso delegado no se podía cerrar desde el portal (`MANUAL_REVIEW_DELEGADA_AL_MOTOR`) y el
 * Motor no avisaba de esa cola: `RISK_NOT_APPROVED` se quedaba puesto para siempre.
 */
function build(caso: Record<string, unknown> | null, resultado: Record<string, unknown> | null = { id: 'res-1', reasonCodesJson: null }) {
  const transaction = { id: 'tx' };
  const revisionManual = {
    findManualReviewCaseByExecutionId: jest.fn(async (..._args: unknown[]) => caso),
    closeManualReviewCase: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const riskRepository = {
    findRiskResultByRun: jest.fn(async (..._args: unknown[]) => resultado),
    applyManualReviewOutcome: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const eligibility = {
    evaluateAndRecord: jest.fn(async (..._args: unknown[]) => ({ eligible: true, blockers: [], lifecycleStatus: 'active' })),
  };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(transaction)) };
  const service = new RiskManualReviewOutcomeService(
    revisionManual as never,
    riskRepository as never,
    eligibility as never,
    sequelize as never,
  );
  return { service, revisionManual, riskRepository, eligibility, transaction };
}

const casoAbierto = () => ({ id: 'mr-1', customerId: 'c-9', riskAssessmentRunId: 'run-4', status: 'open', closedAt: null });
const entrada = { tenantId: '1', executionId: '777', decision: 'APPROVE' as const, reason: 'Todo en orden', resolvedByInternalUserId: '5' };

describe('RiskManualReviewOutcomeService', () => {
  it('APPROVE cierra el caso, corrige el resultado a approved_for_next_step y reevalúa la habilitación', async () => {
    const { service, revisionManual, riskRepository, eligibility, transaction } = build(casoAbierto());

    const result = await service.apply(entrada);

    expect(result).toEqual({ applied: true, caseId: 'mr-1', resolution: 'approved', lifecycleStatus: 'active' });
    expect(revisionManual.closeManualReviewCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mr-1' }),
      expect.objectContaining({ resolution: 'approved', notes: expect.stringContaining('Todo en orden') }),
      { transaction },
    );
    expect(riskRepository.applyManualReviewOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'res-1' }),
      expect.objectContaining({ recommendedAction: 'approved_for_next_step', reason: 'Todo en orden' }),
      { transaction },
    );
    expect(eligibility.evaluateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        customerId: 'c-9',
        decisionSource: 'manual_decision',
        evaluatedByType: 'decision_engine_manual_review',
        evaluatedByInternalUserId: '5',
        reasonCode: 'risk_manual_review_approved',
        transaction,
      }),
    );
  });

  it('DECLINE deja el resultado en rejected y lo reevalúa igual (el cliente no se activa solo)', async () => {
    const { service, riskRepository, eligibility } = build(casoAbierto());
    await expect(service.apply({ ...entrada, decision: 'DECLINE' })).resolves.toMatchObject({ resolution: 'rejected' });
    expect(riskRepository.applyManualReviewOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recommendedAction: 'rejected' }),
      expect.anything(),
    );
    expect(eligibility.evaluateAndRecord).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'risk_manual_review_rejected' }));
  });

  it('un caso ya cerrado no se reabre ni se reevalúa', async () => {
    const { service, riskRepository, eligibility } = build({ ...casoAbierto(), status: 'closed', closedAt: new Date() });
    await expect(service.apply(entrada)).resolves.toEqual({ applied: false, reason: 'CASE_ALREADY_CLOSED', caseId: 'mr-1' });
    expect(riskRepository.applyManualReviewOutcome).not.toHaveBeenCalled();
    expect(eligibility.evaluateAndRecord).not.toHaveBeenCalled();
  });

  it('sin resultado de riesgo asociado cierra el caso igual y reevalúa', async () => {
    const { service, riskRepository, eligibility } = build(casoAbierto(), null);
    await expect(service.apply(entrada)).resolves.toMatchObject({ applied: true });
    expect(riskRepository.applyManualReviewOutcome).not.toHaveBeenCalled();
    expect(eligibility.evaluateAndRecord).toHaveBeenCalledTimes(1);
  });

  it('una ejecución sin caso delegado es 404', async () => {
    const { service } = build(null);
    await expect(service.apply(entrada)).rejects.toBeInstanceOf(NotFoundException);
  });
});
