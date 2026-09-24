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
 * El motor marca con `category: 'TECHNICAL'` la salida económica inválida, con `ENABLING_BASIS_*` la base
 * habilitante ausente, y con códigos `VARIABLE_*` los datos inválidos o vencidos. Un motivo así junto
 * a un `APPROVE` no es una aprobación: es un artefacto que no pudo decidir bien. Va a revisión.
 */
const TECHNICAL_CATEGORIES: ReadonlySet<string> = new Set(['TECHNICAL', 'DATA_QUALITY', 'FRESHNESS', 'OUTPUT_VALIDATION']);
const TECHNICAL_CODE_PREFIXES = [
  'TECHNICAL_',
  'OUTPUT_',
  'FRESHNESS_',
  'DATA_UNKNOWN',
  'CRITICAL_DATA_',
  'CONSENT_',
  'ENABLING_BASIS_',
  'VARIABLE_',
  'ECONOMIC_OUTPUT_',
];

/**
 * Los `NO_DECISION` que el motor emite con 422 y que NO son una negativa sobre el solicitante: datos
 * de entrada inválidos, base habilitante ausente, salida económica fuera de rango. Revisión técnica.
 */
export const TECHNICAL_NO_DECISION_CODES: ReadonlySet<string> = new Set([
  'VARIABLE_MISSING_OR_INVALID',
  'ENABLING_BASIS_MISSING',
  'ECONOMIC_OUTPUT_INVALID',
]);

/** Señales aditivas que el motor puede enviar; cualquiera verdadera anula una aprobación. */
const REVIEW_FLAGS = ['technicalError', 'technicalReview', 'requiresReview', 'reviewRequired', 'criticalDataUnknown', 'degradedInputs'];

/**
 * `technical`: la revisión se debe a que el motor NO pudo decidir bien (dato, base, salida, frescura),
 * no a un juicio de riesgo. Nunca es un rechazo crediticio del cliente ni una aprobación.
 */
export type DecisionVerdict = { kind: 'approved' | 'declined' | 'review'; reason: string; technical?: boolean };

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
 * técnico, sin bandera de revisión, sin variables críticas de frescura desconocida (`freshnessUnknown`)
 * ni entradas degradadas, y sin superar el límite de exposición que el motor publicó. Un rechazo se
 * respeta aunque traiga motivos técnicos (no concede nada), salvo que la ejecución no haya terminado.
 */
export function classifyDecision(response: DecisionResponse): DecisionVerdict {
  const status = String(response.status ?? '').toUpperCase();
  if (!COMPLETED_STATUSES.has(status)) {
    const technicalCode = response.reasonCodes.find((reason) => TECHNICAL_NO_DECISION_CODES.has(reason.code.toUpperCase()))?.code;
    return {
      kind: 'review',
      reason: technicalCode ? `TECHNICAL_NO_DECISION:${technicalCode}` : `STATUS_NOT_COMPLETED:${status || 'EMPTY'}`,
      technical: true,
    };
  }

  const outcome = String(response.outcome ?? '').toUpperCase();
  if (DECLINE_OUTCOMES.has(outcome)) return { kind: 'declined', reason: outcome };
  if (!APPROVE_OUTCOMES.has(outcome)) return { kind: 'review', reason: `OUTCOME_NOT_RECOGNISED:${outcome || 'EMPTY'}` };

  const blocker = approvalBlocker(response);
  return blocker ? { kind: 'review', reason: blocker.reason, technical: blocker.technical } : { kind: 'approved', reason: outcome };
}

/** Lo que impide ejecutar una aprobación: un caso abierto, un motivo técnico, frescura, exposición o una bandera. */
function approvalBlocker(response: DecisionResponse): { reason: string; technical: boolean } | null {
  if (response.manualReview?.caseCode) return { reason: 'MANUAL_REVIEW_OPEN', technical: false };
  const unknown = response.freshnessUnknown ?? [];
  if (unknown.length > 0) return { reason: `FRESHNESS_UNKNOWN:${unknown.join(',')}`, technical: true };
  const technical = response.reasonCodes.find(
    (reason) =>
      TECHNICAL_CATEGORIES.has(String(reason.category ?? '').toUpperCase()) ||
      TECHNICAL_CODE_PREFIXES.some((prefix) => reason.code.toUpperCase().startsWith(prefix)),
  );
  if (technical) return { reason: `TECHNICAL_REASON:${technical.code}`, technical: true };
  const remaining = response.exposure?.remainingAfterDecision;
  if (typeof remaining === 'number' && remaining < 0) return { reason: 'EXPOSURE_LIMIT_EXCEEDED', technical: false };
  const raw = response as Record<string, unknown>;
  const flag = REVIEW_FLAGS.find((name) => raw[name] === true);
  return flag ? { reason: `REVIEW_FLAG:${flag}`, technical: true } : null;
}
