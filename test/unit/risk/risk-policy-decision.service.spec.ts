import { describe, expect, it, jest } from '@jest/globals';
import { RiskPolicyDecisionService } from '../../../src/modules/risk/application/risk-policy-decision.service.js';
import { RISK_RULESET_VERSION } from '../../../src/modules/risk/risk-heuristic-v0.constants.js';

/**
 * `RiskPolicyDecisionService` es la pieza que decide si una evaluación de riesgo la resolvió una
 * POLÍTICA aprobada o el motor heurístico de arranque. Esa distinción no es cosmética: queda
 * persistida en la corrida como `rulesetVersionCode`, y es lo que permite auditar meses después por
 * qué se aprobó o se rechazó a un cliente.
 *
 * La degradación a heurística es deliberada — una instalación sin política cargada tiene que poder
 * operar — pero es exactamente el tipo de camino que se rompe en silencio: si dejara de marcarse
 * como fallback, las decisiones heurísticas pasarían por decisiones de política sin que nada avisara.
 */
describe('RiskPolicyDecisionService', () => {
  const fallback = { decision: 'manual_review_required', reasons: ['missing_identity'] };

  /**
   * `engineDecision` es lo que devuelve el escalón de arriba. `null` = el motor no está configurado
   * o no respondió, que es el caso por defecto de estas pruebas y el que ejercita la cadena local.
   */
  function build(activeRuleset: unknown = null, engineDecision: unknown = null) {
    const policyRepository = { findActiveRuleset: jest.fn(async (..._args: unknown[]) => activeRuleset) };
    const engine = { evaluate: jest.fn(async (..._args: unknown[]) => engineDecision) };
    return {
      service: new RiskPolicyDecisionService(policyRepository as never, engine as never),
      policyRepository,
      engine,
    };
  }

  const input = {
    tenantId: '1',
    customerId: 'c1',
    assessmentType: 'onboarding',
    now: new Date('2026-07-31T12:00:00Z'),
    features: { totalScore: 80, hasIdentity: true },
    fallback,
    idempotencyKey: 'idem-1',
  };

  /**
   * El escalón de arriba. `risk_heuristic_v0` decía de sí mismo que debía sustituirse «cuando exista
   * un motor real basado en políticas versionadas»; ese motor existía en el repositorio de al lado y
   * nadie lo llamaba. Lo que fijan estas pruebas es el ORDEN y, sobre todo, que bajar un escalón
   * quede escrito: dos poblaciones resueltas por criterios distintos no se pueden medir juntas.
   */
  describe('con el motor de decisión disponible', () => {
    const engineDecision = {
      decision: 'approved_for_next_step',
      reasons: ['POLICY_PASS'],
      artifactVersionId: '4001',
      executionId: '88001',
    };

    it('manda el motor: ni siquiera se consulta el ruleset local', async () => {
      const { service, policyRepository } = build({ rules: [{}] }, engineDecision);

      const decision = await service.resolve(input);

      expect(decision.decision).toBe('approved_for_next_step');
      expect(decision.decisionSource).toBe('decision_engine');
      expect(policyRepository.findActiveRuleset).not.toHaveBeenCalled();
    });

    it('ata la decisión a la ejecución y la versión del artefacto que la produjo', async () => {
      const { service } = build(null, engineDecision);

      const decision = await service.resolve(input);

      expect(decision.decisionExecutionId).toBe('88001');
      expect(decision.rulesetVersionCode).toBe('4001');
      // No vino de un ruleset local, y decir lo contrario falsearía la procedencia.
      expect(decision.fromRuleset).toBe(false);
    });

    it('si el motor no responde, baja al escalón local y lo deja escrito', async () => {
      const { service } = build(null, null);

      const decision = await service.resolve(input);

      // Degradar es correcto: esto no concede dinero y bloquear el alta sería peor. Lo que no puede
      // pasar es que el caso quede indistinguible de uno resuelto por el motor.
      expect(decision.decision).toBe(fallback.decision);
      expect(decision.decisionSource).toBe('heuristic_v0');
      expect(decision.decisionExecutionId).toBeNull();
    });
  });

  describe('sin ruleset activo', () => {
    it('degrada a la heurística en vez de bloquear el onboarding', async () => {
      const { service } = build(null);

      const decision = await service.resolve(input);

      expect(decision.decision).toBe(fallback.decision);
      expect(decision.reasons).toEqual(fallback.reasons);
    });

    it('marca la decisión como NO proveniente de política, con la versión del motor de arranque', async () => {
      const { service } = build(null);

      const decision = await service.resolve(input);

      expect(decision.fromRuleset).toBe(false);
      expect(decision.rulesetVersionCode).toBe(RISK_RULESET_VERSION);
      expect(decision.firedRules).toEqual([]);
    });

    it('un ruleset activo SIN reglas se trata como si no hubiera ninguno', async () => {
      const { service } = build({ rulesetVersionId: '9', rulesetCode: 'bnpl', versionCode: 'v3', rules: [] });

      const decision = await service.resolve(input);

      expect(decision.fromRuleset).toBe(false);
      expect(decision.rulesetVersionCode).toBe(RISK_RULESET_VERSION);
    });

    it('consulta el ruleset por tipo de evaluación y momento, no de forma global', async () => {
      const { service, policyRepository } = build(null);

      await service.resolve(input);

      expect(policyRepository.findActiveRuleset).toHaveBeenCalledWith('onboarding', input.now);
    });
  });

  describe('con ruleset activo', () => {
    /** Regla de parada dura: dispara cuando el score no llega al umbral. */
    const hardStopRule = {
      ruleCode: 'score_below_threshold',
      ruleName: 'Score insuficiente',
      riskDimension: 'overall',
      severity: 'high',
      actionCode: 'manual_review_required',
      reasonCode: 'score_below_threshold',
      isHardStop: true,
      expression: { all: [{ field: 'totalScore', lt: 65 }] },
    };

    it('la decisión del ruleset MANDA sobre el fallback', async () => {
      const { service } = build({ rulesetVersionId: '9', rulesetCode: 'bnpl', versionCode: 'v3', rules: [hardStopRule] });

      const decision = await service.resolve({ ...input, features: { totalScore: 40 } });

      expect(decision.fromRuleset).toBe(true);
      expect(decision.decision).toBe('manual_review_required');
      expect(decision.reasons).toContain('score_below_threshold');
    });

    it('persiste la versión REALMENTE aplicada, no la del motor de arranque', async () => {
      const { service } = build({ rulesetVersionId: '9', rulesetCode: 'bnpl', versionCode: 'v3', rules: [hardStopRule] });

      const decision = await service.resolve({ ...input, features: { totalScore: 40 } });

      expect(decision.rulesetVersionCode).toBe('v3');
      expect(decision.rulesetVersionCode).not.toBe(RISK_RULESET_VERSION);
    });

    it('expone las reglas disparadas: sin ellas la decisión no sería explicable', async () => {
      const { service } = build({ rulesetVersionId: '9', rulesetCode: 'bnpl', versionCode: 'v3', rules: [hardStopRule] });

      const decision = await service.resolve({ ...input, features: { totalScore: 40 } });

      expect(decision.firedRules.map((rule) => rule.ruleCode)).toContain('score_below_threshold');
    });

    it('ninguna regla disparada sigue siendo una decisión DE POLÍTICA, no un fallback', async () => {
      const { service } = build({ rulesetVersionId: '9', rulesetCode: 'bnpl', versionCode: 'v3', rules: [hardStopRule] });

      const decision = await service.resolve({ ...input, features: { totalScore: 90 } });

      expect(decision.fromRuleset).toBe(true);
      expect(decision.rulesetVersionCode).toBe('v3');
      expect(decision.firedRules).toEqual([]);
    });
  });
});
