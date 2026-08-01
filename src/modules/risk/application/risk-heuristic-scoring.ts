/**
 * @file Puntajes heurísticos v0 del onboarding y su decisión de respaldo.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system función pura; no consulta la base ni depende de Nest.
 */
import { RISK_APPROVAL_MIN_SCORE, RISK_LEVEL_THRESHOLDS } from '../risk-heuristic-v0.constants.js';

export type HeuristicRiskInputs = {
  hasIdentity: boolean;
  verifiedContactCount: number;
  hasDevice: boolean;
};

export type HeuristicRiskScores = {
  identityScore: number;
  contactScore: number;
  deviceScore: number;
  behaviorScore: number;
  consistencyScore: number;
  fraudScore: number;
  totalScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  missing: string[];
};

/**
 * Puntajes por dimensión del modelo heurístico v0.
 *
 * IMPORTANTE sobre su alcance: estos números alimentan el desglose explicativo y el nivel de riesgo,
 * **no la decisión**. La decisión la toma el ruleset versionado en base de datos cuando hay uno
 * activo (`RiskPolicyDecisionService`); esto es sólo el respaldo y la evidencia de por qué.
 *
 * Se extrae del servicio como función pura por dos motivos: es la parte que un analista de riesgo
 * quiere leer sin atravesar transacciones y persistencia, y es la única que se puede verificar con
 * una tabla de casos en vez de con una base de datos.
 */
export function computeHeuristicScores(inputs: HeuristicRiskInputs): HeuristicRiskScores {
  const { hasIdentity, verifiedContactCount, hasDevice } = inputs;
  const hasVerifiedContact = verifiedContactCount > 0;

  const identityScore = hasIdentity ? 70 : 30;
  const contactScore = hasVerifiedContact ? 90 : 45;
  const deviceScore = hasDevice ? 70 : 55;
  const behaviorScore = 50;
  const consistencyScore = hasIdentity && hasVerifiedContact ? 75 : 45;
  const fraudScore = hasIdentity && hasVerifiedContact ? 20 : 55;

  // El puntaje de fraude entra INVERTIDO: es el único donde "más" significa peor, y promediarlo sin
  // invertir haría que un cliente más sospechoso puntuara más alto.
  const totalScore = Math.round((identityScore + contactScore + deviceScore + behaviorScore + consistencyScore + (100 - fraudScore)) / 6);

  const missing: string[] = [];
  if (!hasIdentity) missing.push('identity_document');
  if (!hasVerifiedContact) missing.push('verified_contact');

  return {
    identityScore,
    contactScore,
    deviceScore,
    behaviorScore,
    consistencyScore,
    fraudScore,
    totalScore,
    riskLevel: riskLevelFor(totalScore),
    missing,
  };
}

function riskLevelFor(totalScore: number): 'low' | 'medium' | 'high' {
  if (totalScore >= RISK_LEVEL_THRESHOLDS.low) return 'low';
  return totalScore >= RISK_LEVEL_THRESHOLDS.medium ? 'medium' : 'high';
}

/**
 * Decisión de respaldo: la que se aplica cuando NO hay ruleset activo que decida.
 *
 * Falta de evidencia manda sobre el puntaje: a un cliente sin documento de identidad no se le abre
 * paso porque el resto de dimensiones promedien bien. Por eso `missing` se evalúa primero.
 */
export function buildHeuristicFallback(scores: Pick<HeuristicRiskScores, 'missing' | 'totalScore'>): {
  decision: string;
  reasons: string[];
} {
  if (scores.missing.length > 0) {
    return { decision: 'manual_review_required', reasons: scores.missing.map((code) => `missing_${code}`) };
  }
  return scores.totalScore >= RISK_APPROVAL_MIN_SCORE
    ? { decision: 'approved_for_next_step', reasons: ['minimum_onboarding_risk_passed'] }
    : // El motivo tiene que decir la verdad: un caso que NO alcanzó el umbral no puede quedar
      // registrado como "riesgo mínimo superado". Ese texto es lo que lee un analista al abrirlo.
      { decision: 'manual_review_required', reasons: ['below_minimum_risk_score'] };
}

/**
 * Mapa de features que se persiste como evidencia de la corrida.
 *
 * Es lo que queda escrito en `feature_values` y en el snapshot, y lo que hace explicable una
 * decisión meses después. Se construye aquí —junto a los puntajes que lo alimentan— para que
 * añadir una dimensión al modelo no exija acordarse de tocar también el servicio.
 */
export function toPersistedFeatureMap(
  scores: HeuristicRiskScores,
  signals: { hasGrantedConsent: boolean; verifiedContactCount: number; hasIdentity: boolean },
): Record<string, number | boolean> {
  return {
    hasGrantedConsent: signals.hasGrantedConsent,
    verifiedContactCount: signals.verifiedContactCount,
    hasIdentity: signals.hasIdentity,
    identityScore: scores.identityScore,
    contactScore: scores.contactScore,
    deviceScore: scores.deviceScore,
    behaviorScore: scores.behaviorScore,
    consistencyScore: scores.consistencyScore,
    fraudScore: scores.fraudScore,
  };
}
