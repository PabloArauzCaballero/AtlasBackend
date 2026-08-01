/**
 * @file Traduce las señales del onboarding al vocabulario de features que leen las reglas.
 * @business Los nombres de feature son el contrato entre la política de riesgo y el motor: una regla
 * aprobada por riesgo se escribe contra estos códigos, no contra nombres internos del código.
 * @system función pura; no consulta nada.
 */

export type OnboardingRiskSignals = {
  hasIdentity: boolean;
  verifiedContactCount: number;
  hasGrantedConsent: boolean;
  identityScore: number;
  contactScore: number;
  deviceScore: number;
  behaviorScore: number;
  consistencyScore: number;
  fraudScore: number;
  totalScore: number;
};

/**
 * Mapa de features en `snake_case`, que es como los rulesets sembrados nombran sus campos.
 *
 * Se mantiene explícito —y no derivado del objeto de entrada— porque estos códigos son un contrato
 * versionado: renombrar una propiedad interna del servicio no puede cambiar en silencio a qué
 * responde una regla de política ya aprobada.
 */
export function toPolicyFeatures(signals: OnboardingRiskSignals): Record<string, number | boolean> {
  return {
    has_identity_document: signals.hasIdentity,
    verified_contact_count: signals.verifiedContactCount,
    has_granted_consent: signals.hasGrantedConsent,
    identity_score: signals.identityScore,
    contact_score: signals.contactScore,
    device_score: signals.deviceScore,
    behavior_score: signals.behaviorScore,
    consistency_score: signals.consistencyScore,
    fraud_score: signals.fraudScore,
    total_score: signals.totalScore,
  };
}
