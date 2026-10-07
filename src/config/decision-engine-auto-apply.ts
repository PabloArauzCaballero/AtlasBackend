/**
 * @file Regla de negocio: qué veredictos del Motor se aplican solos y cuáles van a una persona.
 * @business Permite consultar al Motor en todo el recorrido sin que decida más de lo autorizado.
 * @system lee `DECISION_ENGINE_AUTO_APPLY`; la consultan crédito, riesgo, identidad y comercios. Vive en
 *   `config` (compartido) porque es configuración, no integración con el Motor.
 */
import { env } from './env.js';

/** Los tipos de decisión que pueden delegar en el Motor (espejo de `DECISION_TYPES`). */
export type AutoApplyDecisionType = 'credit' | 'risk' | 'identity' | 'partner';

/** Motivo que acompaña a un veredicto del Motor que se registró pero no se aplicó. */
export const ENGINE_VERDICT_HELD_FOR_MANUAL_REVIEW = 'ENGINE_VERDICT_HELD_FOR_MANUAL_REVIEW';

/**
 * Si el veredicto del Motor para este tipo se aplica sin intervención humana.
 *
 * Lo que NO hace esta función es decidir si se llama al Motor: se llama siempre, para que la
 * ejecución quede en su historial y la información no se pierda. Sólo decide si su veredicto
 * cierra el caso o queda como propuesta para quien revisa.
 */
export function engineVerdictApplies(decisionType: AutoApplyDecisionType): boolean {
  return env.DECISION_ENGINE_AUTO_APPLY.includes(decisionType);
}

/**
 * Si una identidad que el Motor verificó o rechazó espera igualmente a una persona.
 *
 * Lo pide `IDENTITY_REQUIRE_HUMAN_REVIEW` (sin corpus para calibrar la prueba de vida) o dejar la
 * identidad fuera de `DECISION_ENGINE_AUTO_APPLY`. Una sola función para que el canal móvil, la
 * elegibilidad y la bandeja no lean dos respuestas distintas a la misma pregunta.
 */
export function identityRequiresHumanReview(): boolean {
  return env.IDENTITY_REQUIRE_HUMAN_REVIEW || !engineVerdictApplies('identity');
}
