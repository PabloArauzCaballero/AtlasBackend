/**
 * @file Dominio: cuánto es el pago inicial de una compra a cuotas, calculado por el servidor.
 * @business La compra se reparte 60/40: el 60 % se paga directo al comercio al comprar y el 40 % es el crédito.
 *   El cliente avisa cuánto pagó, pero el importe que vale es el que sale de la compra, no el que él escriba:
 *   antes se guardaba lo que mandara la app (auditoría 2026-10-09, APP-04) y el comercio confirmaba a ciegas.
 * @system función pura en centavos enteros. No lee base de datos: recibe el financiado de la solicitud.
 */

/** Parte de la compra que se paga al comercio al comprar, en base 1. Espeja `STANDARD_POLICY_V1` de la app. */
export const DOWN_PAYMENT_SHARE = 0.6;

/** Un importe decimal (`"720.00"`, `720`) en centavos enteros. `null` si no es un importe válido y positivo. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!/^\d{1,16}(\.\d{1,2})?$/u.test(text)) return null;
  const [entero, decimales = ''] = text.split('.');
  return Number(entero) * 100 + Number(decimales.padEnd(2, '0'));
}

/** Centavos a la cadena decimal que guardan las columnas `DECIMAL(18,2)`. */
export function fromCents(cents: number): string {
  const entero = Math.trunc(cents / 100);
  const resto = String(cents % 100).padStart(2, '0');
  return `${entero}.${resto}`;
}

/**
 * Los pagos iniciales que corresponden a un FINANCIADO dado.
 *
 * La solicitud de crédito sólo guarda el financiado (`requested_amount`, el 40 %), no el precio. La app calcula
 * `inicial = round(precio × 0,6)` y `financiado = precio − inicial`, así que, dado el financiado, el precio es
 * cualquier `G` con `G − round(0,6·G) = financiado`. Como el financiado avanza 0,4 centavos por centavo de precio,
 * suele haber dos o tres `G` (y por tanto iniciales) a un centavo uno del otro: se devuelven TODOS, ordenados, y no
 * se adivina uno —rechazar por un centavo el inicial exacto que calculó la app sería un falso «monto incorrecto» en
 * mostrador—. La holgura es, como mucho, de ±1 centavo alrededor de 1,5 × financiado.
 *
 * Vacío si el financiado no es positivo: no hay compra de la que sacar un inicial.
 */
export function expectedDownPaymentCents(financedCents: number): number[] {
  if (!Number.isInteger(financedCents) || financedCents <= 0) return [];
  const financedShare = 1 - DOWN_PAYMENT_SHARE;
  const centro = Math.round(financedCents / financedShare);
  const iniciales = new Set<number>();
  for (let precio = centro - 5; precio <= centro + 5; precio += 1) {
    const inicial = Math.round(precio * DOWN_PAYMENT_SHARE);
    if (precio - inicial === financedCents) iniciales.add(inicial);
  }
  return [...iniciales].sort((a, b) => a - b);
}

export type DownPaymentCheck =
  | { ok: true; amountCents: number; expectedCents: number[] }
  | {
      ok: false;
      code: 'DOWN_PAYMENT_AMOUNT_INVALID' | 'DOWN_PAYMENT_EXPECTED_UNKNOWN' | 'DOWN_PAYMENT_AMOUNT_MISMATCH';
      expectedCents: number[];
    };

/** ¿El importe que dice el cliente es el pago inicial de ESTA compra? */
export function checkDownPaymentAmount(amount: string | number, financedAmount: string | number): DownPaymentCheck {
  const expectedCents = expectedDownPaymentCents(toCents(financedAmount) ?? 0);
  const amountCents = toCents(amount);
  if (amountCents === null || amountCents <= 0) return { ok: false, code: 'DOWN_PAYMENT_AMOUNT_INVALID', expectedCents };
  if (expectedCents.length === 0) return { ok: false, code: 'DOWN_PAYMENT_EXPECTED_UNKNOWN', expectedCents };
  if (!expectedCents.includes(amountCents)) return { ok: false, code: 'DOWN_PAYMENT_AMOUNT_MISMATCH', expectedCents };
  return { ok: true, amountCents, expectedCents };
}

/**
 * El pago inicial que el servidor MUESTRA para un financiado: de los admitidos, el más cercano a 1,5 × financiado
 * (el de un precio redondo). Es el que la app y el comercio deben pintar; los vecinos a un centavo también valen.
 */
export function expectedDownPaymentAmount(financedAmount: string | number | null | undefined): string | null {
  const financiado = toCents(financedAmount) ?? 0;
  const admitidos = expectedDownPaymentCents(financiado);
  if (admitidos.length === 0) return null;
  const ideal = (financiado * DOWN_PAYMENT_SHARE) / (1 - DOWN_PAYMENT_SHARE);
  const [mejor] = [...admitidos].sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b);
  return fromCents(mejor!);
}
