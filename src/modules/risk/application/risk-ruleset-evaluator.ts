/**
 * @file Motor de decisión de riesgo: aplica un ruleset versionado a un mapa de features.
 * @business Cambiar un umbral pasa a ser un cambio de configuración auditado en vez de un despliegue.
 * @system función pura sobre las reglas ya cargadas; la persistencia la resuelve el servicio.
 */
import { FeatureMap, evaluateExpression } from './risk-rule-expression.js';

export type PolicyRule = {
  ruleCode: string;
  ruleName: string | null;
  riskDimension: string | null;
  severity: string | null;
  actionCode: string | null;
  reasonCode: string | null;
  isHardStop: boolean | null;
  expression: unknown;
};

export type FiredRule = {
  ruleCode: string;
  riskDimension: string;
  severity: string;
  actionCode: string;
  reasonCode: string;
  isHardStop: boolean;
};

export type RulesetDecision = {
  /** Decisión final del ruleset, en el vocabulario que ya consume el resto del flujo. */
  decision: 'approved_for_next_step' | 'manual_review_required' | 'blocked';
  firedRules: FiredRule[];
  reasons: string[];
  evaluatedRuleCount: number;
};

/** Acciones que una regla puede pedir, de la más severa a la más permisiva. */
const ACTION_SEVERITY: Readonly<Record<string, number>> = { BLOCK: 3, MANUAL_REVIEW: 2, REVIEW: 2, APPROVE: 1, ALLOW: 1 };

function normalizeAction(rule: PolicyRule): string {
  const declared = (rule.actionCode ?? '').toUpperCase();
  if (ACTION_SEVERITY[declared]) return declared;
  // Una regla con acción desconocida no se ignora: se trata como revisión manual. Descartarla
  // silenciosamente convertiría un error de configuración en una aprobación.
  return 'MANUAL_REVIEW';
}

/**
 * Aplica el ruleset y resuelve la decisión.
 *
 * La precedencia es por severidad, no por orden de aparición: basta UNA regla de bloqueo para
 * bloquear, y una de revisión para escalar. Depender del orden de las filas haría que la decisión
 * cambiara al reordenar el catálogo, que es justo lo que no puede pasar en una política de crédito.
 */
export function evaluateRuleset(rules: readonly PolicyRule[], features: FeatureMap): RulesetDecision {
  const firedRules: FiredRule[] = [];

  for (const rule of rules) {
    if (!evaluateExpression(rule.expression, features)) continue;
    const actionCode = normalizeAction(rule);
    firedRules.push({
      ruleCode: rule.ruleCode,
      riskDimension: rule.riskDimension ?? 'unspecified',
      severity: rule.severity ?? 'medium',
      actionCode,
      reasonCode: rule.reasonCode ?? rule.ruleCode,
      // `is_hard_stop` puede venir desalineado de la acción; manda el que sea más restrictivo.
      isHardStop: rule.isHardStop === true || actionCode === 'BLOCK',
    });
  }

  const worstAction = firedRules.reduce((worst, rule) => Math.max(worst, ACTION_SEVERITY[rule.actionCode] ?? 2), 0);

  return {
    decision: worstAction >= 3 ? 'blocked' : worstAction >= 2 ? 'manual_review_required' : 'approved_for_next_step',
    firedRules,
    reasons: firedRules.length > 0 ? firedRules.map((rule) => rule.reasonCode) : ['no_policy_rule_fired'],
    evaluatedRuleCount: rules.length,
  };
}
