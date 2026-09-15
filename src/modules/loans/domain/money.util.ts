/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system opera importes en enteros de la moneda menor para que ninguna suma dependa del binario flotante.
 */

/**
 * El dinero se lleva en CÉNTIMOS ENTEROS, nunca en `number` decimal.
 *
 * `0.1 + 0.2 !== 0.3` es una curiosidad en un tutorial y un descuadre en un libro de préstamos:
 * doce cuotas de una división inexacta dejan un saldo que no cierra y un cliente al que se le
 * reclama un céntimo que nunca debió. Postgres guarda `NUMERIC(18,2)` —exacto— y Sequelize lo
 * devuelve como STRING justamente para no perderlo al pasar por JavaScript. Estas funciones son la
 * frontera: se entra una vez, se opera en enteros, y se sale una vez.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (text.length === 0) return 0;
  const negative = text.startsWith('-');
  const [wholePart = '0', fractionPart = ''] = text.replace(/^[+-]/, '').split('.');
  const whole = Number.parseInt(wholePart || '0', 10);
  const fraction = Number.parseInt(`${fractionPart}00`.slice(0, 2), 10);
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) {
    throw new Error(`Importe no numérico: ${value}`);
  }
  const cents = whole * 100 + fraction;
  return negative ? -cents : cents;
}

/** Vuelve al texto decimal que espera `NUMERIC(18,2)`. */
export function fromCents(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * Redondeo a céntimo entero al medio hacia arriba, también para negativos.
 *
 * `Math.round(-0.5)` devuelve `-0`, que rompe la simetría al reversar un cobro: lo aplicado y lo
 * deshecho tienen que ser el mismo número con el signo cambiado.
 */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Nunca por debajo de cero: un saldo negativo es un error de cálculo, no un crédito a favor. */
export function clampToZero(cents: number): number {
  return cents > 0 ? cents : 0;
}
