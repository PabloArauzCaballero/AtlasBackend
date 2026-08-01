/**
 * @file Resuelve la decisión de riesgo aplicando el ruleset versionado vigente.
 * @business Cambiar un umbral de política pasa a ser configuración auditada, no un despliegue.
 * @system carga el ruleset activo y lo evalúa; degrada a la heurística de arranque si no hay ninguno.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RISK_RULESET_VERSION } from '../risk-heuristic-v0.constants.js';
import { RiskPolicyRepository } from '../repositories/risk-policy.repository.js';
import { FiredRule, evaluateRuleset } from './risk-ruleset-evaluator.js';

export type PolicyDecision = {
  decision: string;
  reasons: string[];
  /** Versión REALMENTE aplicada. Distingue una política aprobada del motor de arranque. */
  rulesetVersionCode: string;
  firedRules: FiredRule[];
  /** `false` cuando no había ruleset activo y se usó la heurística. */
  fromRuleset: boolean;
};

@Injectable()
export class RiskPolicyDecisionService {
  private readonly logger = new Logger(RiskPolicyDecisionService.name);

  constructor(private readonly policyRepository: RiskPolicyRepository) {}

  /**
   * Si hay un ruleset activo, manda él. Si no lo hay, se degrada a la heurística v0 en vez de
   * bloquear el onboarding: una instalación sin política cargada tiene que poder operar. Lo que sí
   * cambia es el `rulesetVersionCode` persistido en la corrida, de modo que siempre se puede saber
   * si una decisión salió de una política aprobada o del motor de arranque.
   */
  async resolve(input: {
    assessmentType: string;
    now: Date;
    features: Record<string, number | boolean>;
    fallback: { decision: string; reasons: string[] };
  }): Promise<PolicyDecision> {
    const ruleset = await this.policyRepository.findActiveRuleset(input.assessmentType, input.now);
    if (!ruleset || ruleset.rules.length === 0) {
      return { ...input.fallback, rulesetVersionCode: RISK_RULESET_VERSION, firedRules: [], fromRuleset: false };
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
    };
  }
}
