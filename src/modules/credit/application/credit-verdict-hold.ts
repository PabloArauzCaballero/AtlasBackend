/**
 * @file Regla de negocio: cuándo el veredicto de crédito del Motor queda como propuesta.
 * @business El Motor se consulta siempre; si la decisión no puede aplicarse sola, la firma una persona.
 * @system convierte una aprobación o un rechazo del Motor en revisión de Atlas, conservando la ejecución.
 */
import { ENGINE_VERDICT_HELD_FOR_MANUAL_REVIEW, engineVerdictApplies } from '../../../config/decision-engine-auto-apply.js';
import type { DecisionResponse } from '../../decision-engine/decision-engine.types.js';

type Applied = { status: string; decisionMode: string; response: DecisionResponse | null; reasonCodes: string[]; note: string | null };

/**
 * Si la solicitud tiene que esperar a una persona aunque el Motor la haya resuelto: el producto
 * exige revisión manual (`requiresManualReview`) o el crédito está fuera de `DECISION_ENGINE_AUTO_APPLY`.
 */
export function creditVerdictHeld(productRequiresManualReview: boolean): boolean {
  return productRequiresManualReview || !engineVerdictApplies('credit');
}

/**
 * La aprobación o el rechazo del Motor convertidos en propuesta. Queda `under_review` y `manual`:
 * la decide una persona en la bandeja de Atlas, con la ejecución del Motor a la vista; con
 * `decision_engine` la decisión humana se rechazaría como «delegada al Motor». Lo que ya es una
 * revisión —con caso del Motor o sin él— o un diferimiento se deja como está.
 */
export function holdVerdict<T extends Applied>(applied: T): T {
  if (applied.status !== 'approved' && applied.status !== 'rejected') return applied;
  return {
    ...applied,
    status: 'under_review',
    decisionMode: 'manual',
    reasonCodes: [ENGINE_VERDICT_HELD_FOR_MANUAL_REVIEW, ...applied.reasonCodes],
    note: `El motor propuso «${applied.response?.outcome ?? applied.status}»; la solicitud requiere revisión humana.`,
  };
}

/**
 * Si la solicitud todavía espera la respuesta del Motor. `submitted` siempre; `under_review` sólo
 * cuando es un producto de revisión manual que nace así y aún no se consultó: ésa es su PRIMERA
 * consulta. Cualquier otra ya está decidida —o la decidió una persona— y una respuesta tardía no la pisa.
 */
export function awaitsEngineVerdict(
  application: { status: string; decisionExecutionId: string | null },
  holdForManualReview: boolean,
): boolean {
  if (application.status === 'submitted') return true;
  return holdForManualReview && application.status === 'under_review' && !application.decisionExecutionId;
}
