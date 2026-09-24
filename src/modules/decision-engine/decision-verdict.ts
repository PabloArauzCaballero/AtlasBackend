/**
 * @file Utilidad pura: qué respuesta del motor AUTORIZA a conceder, y cuál no (P-10).
 * @business El core no origina con un estado técnico inválido, un dato crítico desconocido o un
 *   resultado pendiente de revisión: sólo una aprobación completa, reconocida y sin reservas.
 * @system lista blanca de estados y desenlaces; cualquier valor que el core no reconoce falla cerrado.
 */
import type { DecisionResponse } from './decision-engine.types.js';

/** Desenlaces del motor que el core interpreta como «no se concede». */
export const DECLINE_OUTCOMES: ReadonlySet<string> = new Set(['DECLINE', 'DECLINED', 'REJECT', 'REJECTED', 'DENY', 'DENIED']);

/** Desenlaces que conceden sin intervención. */
export const APPROVE_OUTCOMES: ReadonlySet<string> = new Set(['APPROVE', 'APPROVED', 'ACCEPT', 'ACCEPTED', 'GRANT', 'GRANTED']);

/** Estados de ejecución que significan que el grafo llegó al final. `NO_DECISION`, `FAILED` o uno nuevo, no. */
export const COMPLETED_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

/**
 * Categorías y prefijos de motivo que delatan un fallo TÉCNICO y no un juicio de riesgo.
 *
 * El motor marca con `category: 'TECHNICAL'` la salida económica inválida, la frescura desconocida o
 * la base habilitante ausente. Un motivo así junto a un `APPROVE` no es una aprobación: es un
 * artefacto que no pudo decidir bien. Va a revisión, no a dinero entregado.
 */
const TECHNICAL_CATEGORIES: ReadonlySet<string> = new Set(['TECHNICAL', 'DATA_QUALITY', 'FRESHNESS', 'OUTPUT_VALIDATION']);
const TECHNICAL_CODE_PREFIXES = ['TECHNICAL_', 'OUTPUT_', 'FRESHNESS_', 'DATA_UNKNOWN', 'CRITICAL_DATA_', 'CONSENT_'];

/** Señales aditivas que el motor puede enviar; cualquiera verdadera anula una aprobación. */
const REVIEW_FLAGS = ['technicalError', 'technicalReview', 'requiresReview', 'reviewRequired', 'criticalDataUnknown'];

export type DecisionVerdict = { kind: 'approved' | 'declined' | 'review'; reason: string };

/**
 * Traduce la respuesta del motor a un veredicto que se pueda ejecutar.
 *
 * Sólo se aprueba con una lista CERRADA. Todo lo demás va a revisión humana, y eso incluye los
 * estados y desenlaces que el core aún no sabe leer: el motor puede publicar mañana un
 * `TECHNICAL_REVIEW` o un `APPROVE_WITH_CONDITIONS`, y tratarlos como aprobación por no reconocerlos
 * concedería un crédito en condiciones que nadie implementó. La lista blanca convierte ese caso en
 * una cola visible en vez de en dinero entregado.
 *
 * Una aprobación además tiene que venir LIMPIA: sin caso de revisión abierto en el motor, sin motivo
 * técnico y sin bandera de revisión. Un rechazo se respeta aunque traiga motivos técnicos (no
 * concede nada), salvo que la ejecución no haya terminado.
 */
export function classifyDecision(response: DecisionResponse): DecisionVerdict {
  const status = String(response.status ?? '').toUpperCase();
  if (!COMPLETED_STATUSES.has(status)) return { kind: 'review', reason: `STATUS_NOT_COMPLETED:${status || 'EMPTY'}` };

  const outcome = String(response.outcome ?? '').toUpperCase();
  if (DECLINE_OUTCOMES.has(outcome)) return { kind: 'declined', reason: outcome };
  if (!APPROVE_OUTCOMES.has(outcome)) return { kind: 'review', reason: `OUTCOME_NOT_RECOGNISED:${outcome || 'EMPTY'}` };

  const blocker = approvalBlocker(response);
  return blocker ? { kind: 'review', reason: blocker } : { kind: 'approved', reason: outcome };
}

/** Lo que impide ejecutar una aprobación: un caso abierto, un motivo técnico o una bandera de revisión. */
function approvalBlocker(response: DecisionResponse): string | null {
  if (response.manualReview?.caseCode) return 'MANUAL_REVIEW_OPEN';
  const technical = response.reasonCodes.find(
    (reason) =>
      TECHNICAL_CATEGORIES.has(String(reason.category ?? '').toUpperCase()) ||
      TECHNICAL_CODE_PREFIXES.some((prefix) => reason.code.toUpperCase().startsWith(prefix)),
  );
  if (technical) return `TECHNICAL_REASON:${technical.code}`;
  const raw = response as Record<string, unknown>;
  const flag = REVIEW_FLAGS.find((name) => raw[name] === true);
  return flag ? `REVIEW_FLAG:${flag}` : null;
}
