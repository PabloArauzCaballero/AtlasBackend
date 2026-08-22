/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza deja escrito qué modelo decidió de verdad cada evaluación de riesgo.
 * @system traduce la procedencia de la decisión al par código/versión que publica la respuesta.
 */
import { RISK_MODEL_CODE, RISK_MODEL_VERSION } from '../risk-heuristic-v0.constants.js';
import type { PolicyDecision } from './risk-policy-decision.service.js';

/** Código que identifica al motor de decisión como autor de la evaluación. */
export const DECISION_ENGINE_MODEL_CODE = 'atlas_decision_engine';

/**
 * Qué modelo decidió DE VERDAD esta evaluación.
 *
 * Seguir publicando `risk_heuristic_v0` mientras la decisión sale del motor sería una mentira sobre
 * la procedencia, y la procedencia es justamente lo que hace defendible una evaluación de riesgo
 * meses después: sin ella, un periodo resuelto por la política local es indistinguible de uno
 * automatizado, y cualquier comparación entre meses compara dos poblaciones creyendo que son una.
 */
export function resolveModelIdentity(policy: Pick<PolicyDecision, 'decisionSource' | 'rulesetVersionCode'>): {
  modelCode: string;
  modelVersion: string;
} {
  if (policy.decisionSource === 'decision_engine') {
    return { modelCode: DECISION_ENGINE_MODEL_CODE, modelVersion: policy.rulesetVersionCode };
  }
  return { modelCode: RISK_MODEL_CODE, modelVersion: RISK_MODEL_VERSION };
}
