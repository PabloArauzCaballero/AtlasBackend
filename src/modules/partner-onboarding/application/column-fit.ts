/**
 * Recorta un texto a la longitud de su columna.
 *
 * `partner_profiles.decision_reason` es VARCHAR(120) y `rejection_reason` VARCHAR(200), pero el
 * motivo lo escribe una persona en el Motor (el comentario de resolución de un caso) y no tiene
 * ese tope. Sin recortar, un comentario largo hace fallar el `UPDATE` con
 * `value too long for type character varying`, y como el job de sincronización procesa los casos
 * en lote, ese único fallo bloquea la aprobación de TODOS los comercios del inquilino en cada
 * ejecución. El texto íntegro sigue en el caso del Motor, que es donde ocurrió.
 *
 * El recorte cuenta puntos de código, no unidades UTF-16: partir un par sustituto dejaría un
 * carácter inválido en la base.
 */
export function fitToColumn(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  const puntos = Array.from(text);
  if (puntos.length <= max) return text;
  return `${puntos
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/** Longitudes de las columnas de `partner_profiles` que reciben texto libre (modelo `PartnerProfileModel`). */
export const PARTNER_PROFILE_DECISION_REASON_MAX = 120;
export const PARTNER_PROFILE_REJECTION_REASON_MAX = 200;
