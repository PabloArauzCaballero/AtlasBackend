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

/**
 * Del tramo de mora del préstamo al enum del artefacto.
 *
 * Las claves son las que `ck_loans` admite de verdad (`current`, `dpd_1_29`, `dpd_30_59`, `dpd_60_89`,
 * `dpd_90_plus`, `written_off`). Hasta 2026-10 el mapa esperaba `dpd_90_119`, `dpd_120_plus` y
 * `charged_off`, que la base nunca escribe: un préstamo a 90+ días o castigado caía al `?? 'CURRENT'` y
 * el artefacto lo leía como al día. Las claves viejas se conservan por si algún dato las trae.
 */
export const DELINQUENCY_MAP: Record<string, string> = {
  current: 'CURRENT',
  dpd_1_29: 'DPD_30',
  dpd_30_59: 'DPD_30',
  dpd_60_89: 'DPD_60',
  dpd_90_plus: 'DPD_90',
  dpd_90_119: 'DPD_90',
  dpd_120_plus: 'DPD_120_PLUS',
  written_off: 'CHARGE_OFF',
  charged_off: 'CHARGE_OFF',
};

/** Gravedad de cada valor del enum del artefacto: el peor de varios préstamos es el de mayor rango, no el último por orden alfabético. */
export const DELINQUENCY_SEVERITY: Record<string, number> = {
  CURRENT: 0,
  DPD_30: 1,
  DPD_60: 2,
  DPD_90: 3,
  DPD_120_PLUS: 4,
  CHARGE_OFF: 5,
};

/** El tramo más grave entre los de todos los préstamos, ya traducido al enum del artefacto. */
export function worstDelinquencyOf(buckets: readonly (string | null | undefined)[]): string {
  return buckets
    .map((bucket) => DELINQUENCY_MAP[String(bucket ?? 'current').toLowerCase()] ?? 'CURRENT')
    .reduce((worst, status) => ((DELINQUENCY_SEVERITY[status] ?? 0) > (DELINQUENCY_SEVERITY[worst] ?? 0) ? status : worst), 'CURRENT');
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
