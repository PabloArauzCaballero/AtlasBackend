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
  const register = jest.fn(async (..._args: unknown[]) => 'hash-del-sujeto');

  function build(configured = true) {
    const client = { isConfigured: configured, execute };
    const bindings = { resolve };
    return new RiskDecisionEngineService(client as never, bindings as never, { register } as never);
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
    register.mockClear();
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

  describe('lo que el Motor contestó queda dicho (C-4/C-5)', () => {
    beforeEach(() => {
      (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = 'RIESGO_ONBOARDING_CLIENTE';
    });

    it('NO_DECISION es una respuesta del Motor, no una avería: se devuelve marcada, no como null', async () => {
      execute.mockResolvedValueOnce({
        executionId: 'ex-4',
        status: 'NO_DECISION',
        outcome: 'NO_DECISION',
        reasonCodes: [{ code: 'VARIABLE_MISSING_OR_INVALID' }],
        artifact: { versionId: 'v-9' },
      });

      // Antes: `null` → quien resolvía la cadena lo registraba `heuristic_v0` / `decision_engine_unavailable`.
      await expect(build().evaluate(input)).resolves.toMatchObject({
        decision: 'manual_review_required',
        reasons: ['VARIABLE_MISSING_OR_INVALID'],
        executionId: 'ex-4',
        noDecision: true,
        engineOutcome: null,
      });
    });

    it('NO_DECISION sin motivos propios deja el suyo: engine_no_decision', async () => {
      execute.mockResolvedValueOnce({ executionId: 'ex-5', status: 'no_decision', outcome: null, reasonCodes: [] });

      await expect(build().evaluate(input)).resolves.toMatchObject({ reasons: ['engine_no_decision'], noDecision: true });
    });

    it('un DECLINE se sigue tratando como revisión (D-P3) pero conserva el desenlace real y lo añade a los motivos', async () => {
      execute.mockResolvedValueOnce({
        executionId: 'ex-6',
        status: 'COMPLETED',
        outcome: 'DECLINE',
        reasonCodes: [{ code: 'SYNTHETIC_IDENTITY_SUSPECTED' }],
        artifact: { versionId: 'v-9' },
      });

      await expect(build().evaluate(input)).resolves.toMatchObject({
        decision: 'manual_review_required',
        reasons: ['SYNTHETIC_IDENTITY_SUSPECTED', 'engine_outcome_decline'],
        engineOutcome: 'DECLINE',
        noDecision: false,
      });
    });

    it('un DECLINE sin motivos propios queda con su desenlace como único motivo, como siempre', async () => {
      execute.mockResolvedValueOnce({ executionId: 'ex-7', status: 'COMPLETED', outcome: 'REJECT', reasonCodes: [] });

      await expect(build().evaluate(input)).resolves.toMatchObject({ reasons: ['engine_outcome_reject'], engineOutcome: 'REJECT' });
    });

    it('un desenlace que no es «no» no añade motivo: sólo el DECLINE lo necesita', async () => {
      execute.mockResolvedValueOnce({
        executionId: 'ex-8',
        status: 'COMPLETED',
        outcome: 'MANUAL_REVIEW',
        reasonCodes: [{ code: 'BELOW_MINIMUM_RISK_SCORE' }],
      });

      await expect(build().evaluate(input)).resolves.toMatchObject({
        reasons: ['BELOW_MINIMUM_RISK_SCORE'],
        engineOutcome: 'MANUAL_REVIEW',
      });
    });

    it('registra el sujeto y manda su referencia: el riesgo y el crédito del mismo cliente se pueden unir', async () => {
      await build().evaluate(input);

      expect(register).toHaveBeenCalledWith({ tenantId: '1', customerId: '25' });
      expect(execute).toHaveBeenCalledWith('RIESGO_ONBOARDING_CLIENTE', expect.objectContaining({ subjectReference: 'hash-del-sujeto' }));
    });

    it('respeta la referencia que ya venga en la llamada y no registra otra', async () => {
      await build().evaluate({ ...input, subjectReference: 'ya-derivada' });

      expect(register).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledWith('RIESGO_ONBOARDING_CLIENTE', expect.objectContaining({ subjectReference: 'ya-derivada' }));
    });

    it('sin sal (register falla) evalúa igual y sin referencia: no degrada la decisión por perder la unión', async () => {
      register.mockRejectedValueOnce(new Error('DECISION_ENGINE_SUBJECT_SALT no está configurada.') as never);

      await expect(build().evaluate(input)).resolves.toMatchObject({ decision: 'approved_for_next_step' });
      expect(execute).toHaveBeenCalledWith('RIESGO_ONBOARDING_CLIENTE', expect.objectContaining({ subjectReference: undefined }));
    });
  });
});
