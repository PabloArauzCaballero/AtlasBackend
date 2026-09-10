/**
 * @file La conversión a número que comparten las señales de underwriting.
 * @business Un rasgo que llega como texto y se lee como cero cambia una decisión sin avisar.
 * @system normaliza a número los valores que llegan como cadena desde la base.
 */

/**
 * Vive aparte para romper un ciclo: la componen tanto las señales como el historial de crédito, y
 * cualquiera de los dos que la exportara obligaría al otro a importarlo de vuelta.
 */
export function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Del tramo de mora del préstamo al enum del artefacto. */
export const DELINQUENCY_MAP: Record<string, string> = {
  current: 'CURRENT',
  dpd_1_29: 'DPD_30',
  dpd_30_59: 'DPD_30',
  dpd_60_89: 'DPD_60',
  dpd_90_119: 'DPD_90',
  dpd_120_plus: 'DPD_120_PLUS',
  charged_off: 'CHARGE_OFF',
};

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
