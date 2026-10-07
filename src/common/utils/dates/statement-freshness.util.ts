/**
 * @file Hasta cuándo un extracto bancario vale como evidencia.
 * @business Un extracto de hace un año no dice cuánto puede pagar alguien hoy.
 * @system regla pura compartida por la capacidad de pago (credit) y las señales del underwriting (decision-engine).
 */

/** Hasta qué antigüedad un extracto vale como evidencia de capacidad (D-2 del plan 2026-10-05). */
export const STATEMENT_MAX_AGE_DAYS = 180;

/** Sin fecha de período no se puede probar que sea reciente, así que no se descarta: lo decide quien la lea. */
export function isStatementTooOld(periodTo: string | Date | null | undefined, now: Date): boolean {
  if (!periodTo) return false;
  const end = new Date(periodTo).getTime();
  if (!Number.isFinite(end)) return false;
  return now.getTime() - end > STATEMENT_MAX_AGE_DAYS * 86_400_000;
}
