/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Explica una evaluación de riesgo diciendo antes quién la decidió.
 * @system compone la explicación a partir del detalle ya leído; no consulta la base.
 */
import type { RiskAssessmentDetail } from './risk-assessment-detail.types.js';

/**
 * La explicación dice de DÓNDE sale antes de decir qué dice.
 *
 * Cuando decidió el Motor, las reglas disparadas y las contribuciones de features que hay aquí son
 * las del cálculo LOCAL: describen algo que no tomó la decisión. Publicarlas sin la procedencia
 * hacía que la pantalla explicara con detalle un cálculo que no ocurrió, y un analista que defiende
 * un rechazo meses después estaría citando el motivo equivocado.
 *
 * Con `decisionSource` delante, quien mira sabe si esto es la explicación o sólo el contexto; con
 * `decisionExecutionId`, puede ir a la explicación de verdad. Es función pura porque lo único que
 * hace es dar forma a datos que ya vinieron: se verifica con una tabla de casos, no con una base.
 */
export function buildRiskExplanation(detail: RiskAssessmentDetail, recommendedAction: string | null) {
  const rules = detail.rulesFired.map((rule) => rule.reasonCode).filter((code): code is string => Boolean(code));
  return {
    decisionSource: detail.run.decisionSource,
    decisionExecutionId: detail.run.decisionExecutionId,
    decision: recommendedAction,
    summary: rules.length > 0 ? `Decisión basada en: ${rules.join(', ')}.` : 'Evaluación registrada sin reglas explicativas adicionales.',
    topPositiveFactors: detail.featureContributions
      .filter((item) => Number(item.scorePoints ?? '0') >= 60)
      .map((item) => ({ code: item.featureCode, label: item.reasonCode, impact: 'positive' })),
    topNegativeFactors: detail.featureContributions
      .filter((item) => Number(item.scorePoints ?? '0') < 60)
      .map((item) => ({ code: item.featureCode, label: item.reasonCode, impact: 'negative' })),
    rulesFired: rules,
    recommendedAction,
  };
}
