/**
 * @file Resuelve la decisión de riesgo aplicando el ruleset versionado vigente.
 * @business Cambiar un umbral de política pasa a ser configuración auditada, no un despliegue.
 * @system carga el ruleset activo y lo evalúa; degrada a la heurística de arranque si no hay ninguno.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RISK_RULESET_VERSION } from '../risk-heuristic-v0.constants.js';
import { RiskDecisionEngineService } from '../../decision-engine/risk-decision-engine.service.js';
import { RiskPolicyRepository } from '../repositories/risk-policy.repository.js';
import { FiredRule, evaluateRuleset } from './risk-ruleset-evaluator.js';

/**
 * De qué escalón salió la decisión. No es telemetría: es lo que impide medir juntas dos
 * poblaciones distintas. Un periodo con el motor caído, resuelto por la política local, tiene un
 * comportamiento propio, y confundirlo con uno automatizado hace que cualquier comparación entre
 * meses compare cosas que no son comparables.
 */
export type RiskDecisionSource = 'decision_engine' | 'ruleset' | 'heuristic_v0';

export type PolicyDecision = {
  decision: string;
  reasons: string[];
  /** Versión REALMENTE aplicada. Distingue una política aprobada del motor de arranque. */
  rulesetVersionCode: string;
  firedRules: FiredRule[];
  /** `false` cuando no había ruleset activo y se usó la heurística. */
  fromRuleset: boolean;
  decisionSource: RiskDecisionSource;
  /** La ejecución del motor, cuando fue él quien decidió. Ata la decisión a su versión. */
  decisionExecutionId: string | null;
};

@Injectable()
export class RiskPolicyDecisionService {
  private readonly logger = new Logger(RiskPolicyDecisionService.name);

  constructor(
    private readonly policyRepository: RiskPolicyRepository,
    private readonly engine: RiskDecisionEngineService,
  ) {}

  /**
   * Cadena de precedencia, de más gobernada a menos: MOTOR → ruleset → heurística v0.
   *
   * El motor va primero porque es el único escalón con política versionada, aprobada, con
   * segregación de funciones y auditoría encadenada. `risk_heuristic_v0` queda donde le corresponde
   * —el último recurso— sin desaparecer: su propio autor dejó escrito que debía sustituirse «cuando
   * exista un motor real basado en políticas versionadas», y ese motor ya existía en el repositorio
   * de al lado sin que nadie lo llamara.
   *
   * Bajar un escalón NUNCA bloquea el onboarding. Esto no concede dinero, y dejar sin dar de alta a
   * un cliente por una avería del motor sería peor que aplicar la política local. Lo que no se
   * degrada es la trazabilidad: `decisionSource` deja escrito de qué escalón salió cada caso.
   */
  async resolve(input: {
    tenantId: string;
    customerId: string;
    assessmentType: string;
    now: Date;
    features: Record<string, number | boolean>;
    fallback: { decision: string; reasons: string[] };
    idempotencyKey: string;
    subjectReference?: string;
  }): Promise<PolicyDecision> {
    const fromEngine = await this.engine.evaluate({
      tenantId: input.tenantId,
      customerId: input.customerId,
      assessmentType: input.assessmentType,
      features: input.features,
      idempotencyKey: input.idempotencyKey,
      subjectReference: input.subjectReference,
    });
    if (fromEngine) {
      return {
        decision: fromEngine.decision,
        reasons: fromEngine.reasons,
        // La versión aplicada es la del artefacto, no la de un ruleset local que no participó.
        rulesetVersionCode: fromEngine.artifactVersionId ?? 'decision-engine',
        firedRules: [],
        fromRuleset: false,
        decisionSource: 'decision_engine',
        decisionExecutionId: fromEngine.executionId,
      };
    }

    const ruleset = await this.policyRepository.findActiveRuleset(input.assessmentType, input.now);
    if (!ruleset || ruleset.rules.length === 0) {
      return {
        ...input.fallback,
        rulesetVersionCode: RISK_RULESET_VERSION,
        firedRules: [],
        fromRuleset: false,
        decisionSource: 'heuristic_v0',
        decisionExecutionId: null,
      };
    }

    const evaluation = evaluateRuleset(ruleset.rules, input.features);
    this.logger.log(
      `Riesgo evaluado con el ruleset ${ruleset.rulesetCode}/${ruleset.versionCode}: ` +
        `${evaluation.firedRules.length}/${evaluation.evaluatedRuleCount} reglas disparadas → ${evaluation.decision}.`,
    );
    return {
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      rulesetVersionCode: ruleset.versionCode,
      firedRules: evaluation.firedRules,
      fromRuleset: true,
      decisionSource: 'ruleset',
      decisionExecutionId: null,
    };
  }
}
