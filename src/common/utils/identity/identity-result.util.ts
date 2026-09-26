/**
 * @file Utilidad transversal: normaliza el resultado de una verificación de identidad.
 * @business El mismo «sí, es esta persona» tiene que valer igual venga del canal que venga.
 * @system homogeneiza la lectura de `identity_verification_attempts.final_result`, que dos canales
 *   escriben con casing y vocabulario distintos, y decide qué intento manda cuando hay varios.
 */

/**
 * `identity_verification_attempts.final_result` no tiene un único vocabulario.
 *
 * El canal directo (SEGIP vía el paquete de alta, y la revisión manual que lo resuelve) escribe en
 * minúsculas: `verified` | `rejected` | `pending_review` (ver `identity-verification-outcome.ts`).
 * El canal móvil (el grafo del Motor, `mobile-identity.service.ts`) escribe en MAYÚSCULAS y con otro
 * vocabulario: `VERIFIED` | `REJECTED` | `IN_REVIEW` | `PENDING` | `UNAVAILABLE`. Son el mismo hecho
 * de negocio —¿esta persona quedó verificada?— contado por dos sistemas distintos.
 *
 * Comparar en estricto contra `'verified'` —que es lo que hacía casi todo el código antes de esta
 * función— deja a un cliente verificado por el canal móvil como si nunca se hubiera verificado: el
 * Motor de crédito lo ve `PENDING` y con biometría en cero, y `payment-capacity` lo descarta como
 * incompleto. No es un caso raro: es CUALQUIER alta que pasó por el móvil.
 *
 * Esta función es la única fuente de verdad para LEER ese campo. La fila conserva el crudo de quien la
 * escribió —es evidencia de qué canal decidió y el móvil lo sirve tal cual a la app—, así que una
 * resolución posterior se escribe en el vocabulario de la fila (`identityResultForRow`), no en el de
 * quien resuelve.
 */
export type NormalizedIdentityResult = 'verified' | 'rejected' | 'pending_review' | 'unavailable' | 'unknown';

const NORMALIZED_BY_RAW: Readonly<Record<string, NormalizedIdentityResult>> = {
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  PENDING_REVIEW: 'pending_review',
  // El canal móvil manda el caso a una persona con este nombre; es el mismo hecho que `pending_review`.
  IN_REVIEW: 'pending_review',
  // Estado inicial del canal móvil, antes de que el motor conteste. Tampoco es un veredicto.
  PENDING: 'pending_review',
  UNAVAILABLE: 'unavailable',
};

/** Resultados que YA NO van a cambiar solos: alguien —el proveedor o una persona— llegó a un veredicto. */
const TERMINAL_RESULTS: ReadonlySet<NormalizedIdentityResult> = new Set(['verified', 'rejected']);

/** El vocabulario cerrado y en minúsculas, sea cual sea el canal que escribió la fila. */
export function normalizeIdentityResult(raw: string | null | undefined): NormalizedIdentityResult {
  if (!raw) return 'unknown';
  return NORMALIZED_BY_RAW[raw.trim().toUpperCase()] ?? 'unknown';
}

/** Si ESTE intento, por sí solo, dice que la persona quedó verificada. */
export function isIdentityVerified(raw: string | null | undefined): boolean {
  return normalizeIdentityResult(raw) === 'verified';
}

/** Si el intento ya llegó a un veredicto (verificado o rechazado) del que ya no se vuelve. */
export function isTerminalIdentityResult(raw: string | null | undefined): boolean {
  return TERMINAL_RESULTS.has(normalizeIdentityResult(raw));
}

/**
 * Ventana de intentos que se mira para decidir cuál es el vigente.
 *
 * No hace falta el historial completo: basta con cubrir con margen los reintentos reales de una
 * misma alta. Acotar la consulta evita un escaneo sin límite en la fila más común (una persona con
 * uno o dos intentos), sin arriesgarse a no ver el terminal en un caso con más reintentos.
 */
export const IDENTITY_ATTEMPT_LOOKBACK_LIMIT = 20;

export type IdentityAttemptLike = { finalResult: string | null };

/** Veredicto que una persona o el proveedor le pone a un intento: los dos únicos que cierran. */
export type IdentityVerdict = 'verified' | 'rejected';

/**
 * El veredicto, escrito en el vocabulario de la fila a la que se le pone.
 *
 * El canal móvil escribe `VERIFIED`/`REJECTED` y `mobile-identity.service.get` devuelve la columna
 * TAL CUAL a la app, cuyo contrato (`IdentityVerificationState`) es en mayúsculas: resolver una
 * revisión humana con `verified` en minúsculas dejaba ese intento con un estado que la app no
 * conoce. El canal directo escribe en minúsculas. Se distingue por cómo está escrito el valor que
 * la fila ya tiene —todo en mayúsculas es del móvil— y no por la columna de canal, para no atar
 * esta utilidad a un módulo de identidad concreto. Sin valor previo, el vocabulario por defecto es
 * el del canal directo. Leer el resultado sigue siendo `normalizeIdentityResult`, que entiende los dos.
 */
export function identityResultForRow(verdict: IdentityVerdict, currentRaw: string | null | undefined): string {
  const raw = currentRaw?.trim();
  const isUpperCaseVocabulary = !!raw && raw === raw.toUpperCase() && raw !== raw.toLowerCase();
  return isUpperCaseVocabulary ? verdict.toUpperCase() : verdict;
}

/**
 * De una lista de intentos ya ordenada por más reciente primero, el que manda hoy.
 *
 * Manda el primero cuyo resultado es TERMINAL (`verified`/`rejected`): un intento posterior en
 * `pending_review`/`IN_REVIEW`/`PENDING`/`UNAVAILABLE` es una pregunta que todavía no se contestó, y
 * no puede tapar una respuesta que ya se dio. Sin esta regla, un canal que vuelve a preguntar —el
 * móvil reintentando, un extracto que llega tarde— apaga sin querer un `verified` que ya costó
 * conseguir, y la elegibilidad se bloquea otra vez sin que nadie lo decidiera.
 *
 * Si nadie llegó todavía a un veredicto, manda el más reciente —que es lo único que hay que contar—.
 */
export function pickCurrentIdentityAttempt<T extends IdentityAttemptLike>(attemptsNewestFirst: readonly T[]): T | null {
  const terminal = attemptsNewestFirst.find((attempt) => isTerminalIdentityResult(attempt.finalResult));
  return terminal ?? attemptsNewestFirst[0] ?? null;
}

/**
 * De una lista de intentos ya ordenada por más reciente primero, el que ESPERA una decisión.
 *
 * Es lo que hay que resolver cuando alguien aprueba o rechaza la identidad de un cliente sin decir
 * qué intento: el más reciente que todavía no llegó a un veredicto. Un `verified` anterior del otro
 * canal no es lo que se está revisando, y sobrescribirlo con el veredicto de otra persona sobre
 * otro intento es exactamente el daño que este módulo evita. Si todos ya son terminales, manda el
 * más reciente —lo que había antes de esta regla—.
 */
export function pickAttemptAwaitingReview<T extends IdentityAttemptLike>(attemptsNewestFirst: readonly T[]): T | null {
  const open = attemptsNewestFirst.find((attempt) => !isTerminalIdentityResult(attempt.finalResult));
  return open ?? attemptsNewestFirst[0] ?? null;
}
