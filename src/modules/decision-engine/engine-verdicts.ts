/**
 * @file Utilidad pura: traduce las respuestas por fila del motor a veredictos del core.
 * @business Un lote aceptado a medias tiene que poder decir QUÉ fila no entró.
 * @system mapea `results[]` del motor a tipos propios, tolerando que falte el campo.
 */
import type { FacilityOutcomeResult, FacilityRegistrationOutcome } from './decision-engine.types.js';

/**
 * El motor contesta fila a fila, y esa forma es la que hay que preservar.
 *
 * Un 200 con «1.998 aceptadas» deja al operador sin saber cuáles fueron las dos que no, y la
 * reacción natural a eso es reenviar el archivo entero. Por eso estos mapeos NO colapsan la
 * respuesta en un booleano: devuelven el veredicto de cada fila con su motivo.
 *
 * Y toleran que `results` no venga: un cambio de forma en el motor no debe convertirse en una
 * excepción a mitad del barrido —eso marcaría como fallidas filas que quizá entraron—. Sin
 * veredictos, quien llama no marca nada, que es la postura segura.
 */
export function parseFacilityRegistrations(json: unknown): FacilityRegistrationOutcome[] {
  return rows(json).map((entry) => ({
    externalReference: String(entry.externalReference ?? ''),
    accepted: entry.status === 'REGISTERED' || entry.accepted === true,
    reason: motivo(entry.code ?? entry.reason),
    duplicate: entry.duplicate === true,
  }));
}

export function parseFacilityOutcomes(json: unknown): FacilityOutcomeResult[] {
  return rows(json).map((entry) => ({
    externalReference: String(entry.externalReference ?? ''),
    windowDays: Number(entry.windowDays ?? 0),
    accepted: entry.status === 'RECORDED' || entry.accepted === true,
    reason: motivo(entry.code ?? entry.reason),
    duplicate: entry.duplicate === true,
  }));
}

/**
 * El motor contesta en `rows` (su `RowResultDto`: `accepted`, `code`, `duplicate`). El core leía
 * `results` y `reason`, que el motor nunca emitió: cada alta aceptada se quedaba sin marcar y cada
 * rechazo de desenlace se daba por enviado. `results` se sigue aceptando por compatibilidad.
 */
function rows(json: unknown): Array<Record<string, unknown>> {
  const body = json as { rows?: unknown; results?: unknown } | null;
  const list = body?.rows ?? body?.results;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/** `null` y no `'null'`: el motivo ausente significa «aceptada», no «rechazada sin motivo». */
function motivo(valor: unknown): string | null {
  return valor === undefined || valor === null ? null : String(valor);
}
