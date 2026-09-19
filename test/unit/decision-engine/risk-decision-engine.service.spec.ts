import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RiskDecisionEngineService } from '../../../src/modules/decision-engine/risk-decision-engine.service.js';
import { env } from '../../../src/config/env.js';

type Mutable = { DECISION_ENGINE_RISK_ARTIFACT?: string };

/**
 * El escalón «Motor» del riesgo de onboarding. Medido el 2026-09-14: nunca se había ejecutado
 * porque exigía la variable de entorno ANTES de mirar la asignación del portal.
 */
describe('RiskDecisionEngineService', () => {
  const original = env.DECISION_ENGINE_RISK_ARTIFACT;
  const execute = jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
    executionId: 'ex-1',
    status: 'COMPLETED',
    outcome: 'APPROVE',
    reasonCodes: [],
    artifact: { versionId: 'v-9' },
    manualReview: null,
  }));
  const resolve = jest.fn(async (..._args: unknown[]) => ({ artifactCode: null as string | null }));

  function build(configured = true) {
    const client = { isConfigured: configured, execute };
    const bindings = { resolve };
    return new RiskDecisionEngineService(client as never, bindings as never);
  }

  const input = {
    tenantId: '1',
    customerId: '25',
    assessmentType: 'onboarding_initial',
    features: { total_score: 80 },
    idempotencyKey: 'idem-1',
  };

  beforeEach(() => {
    execute.mockClear();
    resolve.mockClear();
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = original;
  });

  it('sin Motor configurado no participa (null) y no consulta nada', async () => {
    const service = build(false);
    expect(service.isEnabled).toBe(false);
    await expect(service.evaluate(input)).resolves.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('la asignación del portal manda aunque el entorno no declare artefacto', async () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = undefined;
    resolve.mockResolvedValueOnce({ artifactCode: 'RIESGO_DEL_PORTAL' });

    const decision = await build().evaluate(input);

    expect(execute).toHaveBeenCalledWith('RIESGO_DEL_PORTAL', expect.objectContaining({ idempotencyKey: 'idem-1' }));
    expect(decision).toMatchObject({
      decision: 'approved_for_next_step',
      executionId: 'ex-1',
      artifactVersionId: 'v-9',
      manualReviewCaseCode: null,
    });
  });

  it('sin asignación ni variable, no hay a quién preguntar: null', async () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = undefined;
    await expect(build().evaluate(input)).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('el entorno es el respaldo cuando el portal no asignó nada', async () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = 'RIESGO_ONBOARDING_CLIENTE';
    await build().evaluate(input);
    expect(execute).toHaveBeenCalledWith(
      'RIESGO_ONBOARDING_CLIENTE',
      expect.objectContaining({ variables: { total_score: 80, assessment_type: 'onboarding_initial' } }),
    );
  });

  it('un desenlace que no es «sigue adelante» manda a una persona y propaga el caso del Motor', async () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = 'RIESGO_ONBOARDING_CLIENTE';
    execute.mockResolvedValueOnce({
      executionId: 'ex-2',
      status: 'COMPLETED',
      outcome: 'MANUAL_REVIEW',
      reasonCodes: [{ code: 'BELOW_MINIMUM_RISK_SCORE' }],
      artifact: { versionId: 'v-9' },
      manualReview: { caseCode: 'MRC-2', queueCode: 'RIESGO_ONBOARDING' },
    });
    await expect(build().evaluate(input)).resolves.toMatchObject({
      decision: 'manual_review_required',
      reasons: ['BELOW_MINIMUM_RISK_SCORE'],
      manualReviewCaseCode: 'MRC-2',
    });
  });

  it('una ejecución que no terminó, o un fallo del Motor, degradan a null sin lanzar', async () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = 'RIESGO_ONBOARDING_CLIENTE';
    execute.mockResolvedValueOnce({ executionId: 'ex-3', status: 'FAILED', outcome: null, reasonCodes: [] });
    await expect(build().evaluate(input)).resolves.toBeNull();
    execute.mockRejectedValueOnce(new Error('No active deployment'));
    await expect(build().evaluate(input)).resolves.toBeNull();
  });
});
