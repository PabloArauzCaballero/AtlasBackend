/**
 * @file Traduce las señales del onboarding al vocabulario de features que leen las reglas.
 * @business Los nombres de feature son el contrato entre la política de riesgo y el motor: una regla
 * aprobada por riesgo se escribe contra estos códigos, no contra nombres internos del código.
 * @system función pura; no consulta nada.
 */

import { contarRitmo, type RiskFraudFacts } from './risk-fraud-flags.js';

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
  /** Banderas de fraude del alta; opcional para quien construye las señales a mano. */
  fraudFlags?: { strong: readonly string[]; medium: readonly string[]; escalate: boolean };
  /** Los hechos crudos de fraude; `null` o ausente = no se leyeron. */
  fraudFacts?: RiskFraudFacts | null;
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
    fraud_flags_strong: signals.fraudFlags?.strong.length ?? 0,
    fraud_flags_medium: signals.fraudFlags?.medium.length ?? 0,
    ...fraudFactFeatures(signals.fraudFacts ?? null),
  };
}

/**
 * Los hechos de fraude con los nombres que declara `RIESGO_ONBOARDING_CLIENTE` 2.0.0.
 *
 * Lo que no se sabe NO viaja: las quince entradas son opcionales en el artefacto, y mandar `false` o `0` por un dato
 * que no se leyó sería afirmar «dispositivo limpio» sin haberlo comprobado. La 1.0.0 no las declara y las ignora.
 */
export function fraudFactFeatures(hechos: RiskFraudFacts | null): Record<string, number | boolean> {
  if (!hechos) return {};
  const ritmo = contarRitmo(hechos.rhythmSignals);
  const conValor: Record<string, number | boolean | null> = {
    device_emulator: hechos.emulator,
    device_rooted: hechos.rooted,
    location_mocked_pings: hechos.mockedLocationPings,
    device_shared_customers: hechos.sharedDeviceCustomers,
    ip_customers_24h: hechos.sameIpCustomers24h,
    session_devices: hechos.sessionDevices,
    behavior_bot_score: hechos.botScore,
    rhythm_strong_signals: ritmo.strong,
    rhythm_medium_signals: ritmo.medium,
    contacts_available: hechos.contactsAvailable,
    contacts_total: hechos.contactsTotal,
    contacts_days_since_last_new: hechos.contactsDaysSinceLastNew,
    contacts_signals: hechos.contactSignals.length,
  };
  return Object.fromEntries(Object.entries(conValor).filter((par): par is [string, number | boolean] => par[1] !== null));
}
