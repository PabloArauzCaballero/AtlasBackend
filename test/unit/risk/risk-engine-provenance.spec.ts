/**
 * @file Verifica que el riesgo de onboarding registre la VERDAD de lo que el Motor contestó.
 * @business El origen de una decisión no se falsea: un `NO_DECISION` del Motor no es una heurística local, y un «no» del Motor no es una revisión anónima.
 * @system Encadena `RiskDecisionEngineService` → `RiskPolicyDecisionService` → `RiskService` con dobles sólo en los bordes (C-4/C-5, D-P3).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { RiskDecisionEngineService } from '../../../src/modules/decision-engine/risk-decision-engine.service.js';
import { RiskPolicyDecisionService } from '../../../src/modules/risk/application/risk-policy-decision.service.js';
import { RiskService } from '../../../src/modules/risk/risk.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { CreateRiskAssessmentDto } from '../../../src/modules/risk/risk.schemas.js';

type Mutable = { DECISION_ENGINE_RISK_ARTIFACT?: string };

const user: AuthenticatedUser = { sub: 'customer-1', role: 'customer', customerId: 'customer-1', tenantId: 'tenant-1' };
const body = { assessmentType: 'onboarding_initial', channel: 'mobile_app', deviceId: 'device-1' } as CreateRiskAssessmentDto;

function build(engineResponse: Record<string, unknown> | Error) {
  const original = env.DECISION_ENGINE_RISK_ARTIFACT;
  (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = 'RIESGO_ONBOARDING_CLIENTE';

  const client = {
    isConfigured: true,
    execute: jest.fn(async (..._args: unknown[]) => {
      if (engineResponse instanceof Error) throw engineResponse;
      return engineResponse;
    }),
  };
  const bindings = { resolve: jest.fn(async (..._args: unknown[]) => ({ artifactCode: null as string | null })) };
  const subjects = { register: jest.fn(async (..._args: unknown[]) => 'hash-del-sujeto') };
  const engine = new RiskDecisionEngineService(client as never, bindings as never, subjects as never);
  const policyRepository = { findActiveRuleset: jest.fn(async (..._args: unknown[]) => null) };
  const policy = new RiskPolicyDecisionService(policyRepository as never, engine);

  const riskRepository = {
    findCustomerConsents: jest.fn(async (..._args: unknown[]) => [{ granted: true, revokedAt: null }]),
    findCustomerContacts: jest.fn(async (..._args: unknown[]) => [{ status: 'verified' }]),
    findIdentityDocuments: jest.fn(async (..._args: unknown[]) => [{ id: 'doc-1' }]),
    createFeatureComputationRun: jest.fn(async (..._args: unknown[]) => ({ id: 'f1' })),
    createFeatureValue: jest.fn(async (..._args: unknown[]) => ({ id: 'f2' })),
    createFeatureSnapshot: jest.fn(async (..._args: unknown[]) => ({ id: 's1' })),
    createRiskAssessmentRun: jest.fn(async (..._args: unknown[]) => ({ id: 'run-1' })),
    attachSnapshotToRun: jest.fn(async (..._args: unknown[]) => undefined),
    createRiskAssessmentContext: jest.fn(async (..._args: unknown[]) => ({ id: 'c1' })),
    createRuleFired: jest.fn(async (..._args: unknown[]) => ({ id: 'r1' })),
    createContribution: jest.fn(async (..._args: unknown[]) => ({ id: 'k1' })),
    createRiskResult: jest.fn(async (..._args: unknown[]) => ({ id: 'res-1' })),
    createAudit: jest.fn(async (..._args: unknown[]) => ({ id: 'a1' })),
  };
  const revisionManual = {
    createManualReviewCase: jest.fn(async (..._args: unknown[]) => ({ id: 'case-1' })),
    createDataQualityIssue: jest.fn(async (..._args: unknown[]) => ({ id: 'dq-1' })),
  };
  const customers = { findById: jest.fn(async (..._args: unknown[]) => ({ lifecycleStatus: 'active' })) };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
  const service = new RiskService(riskRepository as never, revisionManual as never, customers as never, policy, sequelize as never);

  const restore = () => {
    (env as Mutable).DECISION_ENGINE_RISK_ARTIFACT = original;
  };
  return { service, client, subjects, riskRepository, revisionManual, restore };
}

async function run(engineResponse: Record<string, unknown> | Error) {
  const built = build(engineResponse);
  try {
    const result = await built.service.createRiskAssessment({
      tenantId: 't1',
      customerId: 'customer-1',
      body,
      currentUser: user,
      idempotencyKey: 'idem-1',
    });
    return { ...built, result };
  } finally {
    built.restore();
  }
}

describe('C-5 · un NO_DECISION del Motor no se registra como heurística local', () => {
  const noDecision = {
    executionId: 'exec-77',
    status: 'NO_DECISION',
    outcome: 'NO_DECISION',
    reasonCodes: [{ code: 'VARIABLE_MISSING_OR_INVALID' }],
    artifact: { versionId: 'v-9' },
  };

  it('graba decision_source = engine_no_decision con la ejecución del Motor, NUNCA heuristic_v0', async () => {
    const { result, riskRepository } = await run(noDecision);

    // Antes: el Motor respondía, `evaluate` devolvía null, y la fila decía `heuristic_v0` con el motivo
    // `decision_engine_unavailable` aunque el Motor SÍ había contestado (y dejado su ejecución).
    expect(riskRepository.createRiskAssessmentRun).toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'engine_no_decision', decisionExecutionId: 'exec-77' }),
      expect.anything(),
    );
    expect(riskRepository.createRiskAssessmentRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'heuristic_v0' }),
      expect.anything(),
    );
    expect(result.decisionSource).toBe('engine_no_decision');
    expect(result.decisionExecutionId).toBe('exec-77');
  });

  it('no publica el motivo decision_engine_unavailable ni el modelo heurístico: el Motor SÍ respondió', async () => {
    const { result } = await run(noDecision);

    expect(result.reasons.map((reason) => reason.code)).toEqual(['VARIABLE_MISSING_OR_INVALID']);
    expect(result.reasons.map((reason) => reason.code)).not.toContain('decision_engine_unavailable');
    expect(result.modelCode).not.toBe('risk_heuristic_v0');
  });

  it('sigue yendo a revisión con caso propio: sin veredicto no se aprueba (D-P3)', async () => {
    const { result, revisionManual } = await run(noDecision);

    expect(result.decision).toBe('manual_review_required');
    // El Motor no abrió caso, así que Atlas abre el suyo y no nace delegado.
    expect(revisionManual.createManualReviewCase).toHaveBeenCalledWith(
      expect.objectContaining({ decisionExecutionId: null }),
      expect.anything(),
    );
  });

  it('un motor que de verdad no responde SÍ sigue siendo heuristic_v0 (control positivo)', async () => {
    const { result } = await run(new Error('ECONNREFUSED'));

    expect(result.decisionSource).toBe('heuristic_v0');
    expect(result.decisionExecutionId).toBeNull();
  });
});

describe('C-5 · un «no» del Motor queda registrado como decisión real del Motor', () => {
  const decline = {
    executionId: 'exec-88',
    status: 'COMPLETED',
    outcome: 'DECLINE',
    reasonCodes: [{ code: 'SYNTHETIC_IDENTITY_SUSPECTED' }],
    artifact: { versionId: 'v-9' },
    manualReview: null,
  };

  it('el desenlace real (DECLINE) queda en la evidencia, junto a los motivos del artefacto', async () => {
    const { riskRepository } = await run(decline);

    // Antes el «no» se aplanaba a `manual_review_required` y sólo quedaban los motivos del artefacto:
    // la fila no decía que el Motor había rechazado.
    const ruleCodes = riskRepository.createRuleFired.mock.calls.map(([values]) => (values as { ruleCode: string }).ruleCode);
    expect(ruleCodes).toEqual(['SYNTHETIC_IDENTITY_SUSPECTED', 'engine_outcome_decline']);
  });

  it('la fuente es decision_engine con su ejecución: fue una decisión REAL del Motor', async () => {
    const { result, riskRepository } = await run(decline);

    expect(riskRepository.createRiskAssessmentRun).toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'decision_engine', decisionExecutionId: 'exec-88' }),
      expect.anything(),
    );
    expect(result.modelCode).not.toBe('risk_heuristic_v0');
  });

  it('el resultado práctico para el cliente sigue siendo REVISIÓN, no rechazo (D-P3, decisión de Pablo)', async () => {
    const { result, riskRepository } = await run(decline);

    expect(result.decision).toBe('manual_review_required');
    expect(riskRepository.createRiskResult).toHaveBeenCalledWith(
      expect.objectContaining({ recommendedAction: 'manual_review_required' }),
      expect.anything(),
    );
  });
});

describe('C-4 · el riesgo pasa la referencia del sujeto, la misma que ve el crédito', () => {
  const approve = { executionId: 'exec-1', status: 'COMPLETED', outcome: 'APPROVE', reasonCodes: [], artifact: { versionId: 'v-9' } };

  it('la llamada al Motor lleva subjectReference y se registra el sujeto del cliente', async () => {
    const { client, subjects } = await run(approve);

    expect(subjects.register).toHaveBeenCalledWith({ tenantId: 't1', customerId: 'customer-1' });
    expect(client.execute).toHaveBeenCalledWith(
      'RIESGO_ONBOARDING_CLIENTE',
      expect.objectContaining({ subjectReference: 'hash-del-sujeto' }),
    );
  });

  it('si el registro del sujeto falla, el Motor igual decide: perder la unión no degrada al cliente', async () => {
    const built = build(approve);
    built.subjects.register.mockRejectedValueOnce(new Error('DECISION_ENGINE_SUBJECT_SALT no está configurada.') as never);
    try {
      const result = await built.service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'customer-1',
        body,
        currentUser: user,
        idempotencyKey: 'idem-1',
      });

      expect(result.decisionSource).toBe('decision_engine');
      expect(built.client.execute).toHaveBeenCalledWith(
        'RIESGO_ONBOARDING_CLIENTE',
        expect.objectContaining({ subjectReference: undefined }),
      );
    } finally {
      built.restore();
    }
  });
});
