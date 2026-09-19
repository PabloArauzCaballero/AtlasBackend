/**
 * @file Cuánto pesa la RELACIÓN del cliente con Atlas en su capacidad de pago.
 * @business Alguien que lleva tiempo y ha pagado bien no es lo mismo que alguien que llega hoy.
 * @system puntúa antigüedad, historial de pago y fidelidad, cada uno acotado.
 */
import type { RelationshipInput } from './payment-capacity.types.js';
import { clamp } from './payment-capacity.js';

/**
 * Salen de `payment-capacity.ts` porque son una dimensión aparte: aquel archivo calcula cuánto
 * puede pagar alguien con lo que ingresa y gasta, y esto ajusta esa cifra por cómo se ha
 * comportado. Juntos pasaban de las 300 líneas de `check:file-size`.
 */
/**
 * La antigüedad, en puntos.
 *
 * Satura a los doce meses y no crece más: el primer año es donde la antigüedad discrimina de verdad
 * —quien lleva un mes y quien lleva un año no se parecen en nada— y a partir de ahí lo que
 * distingue a un cliente de otro es cómo paga, no cuánto lleva. Dejarla crecer indefinidamente
 * premiaría la inercia por encima del comportamiento.
 */
export function tenureScore(tenureMonths: number): number {
  return Math.round(clamp(tenureMonths / 12, 0, 1) * 100);
}

/**
 * El historial de pago DENTRO de Atlas, en puntos.
 *
 * Sin historial se parte de 50 y no de 0: cero significa «paga fatal», y quien no ha pedido nunca no
 * paga fatal — simplemente no ha pagado. Confundir las dos cosas le niega crédito a quien nunca lo
 * pidió, que es el error que este producto existe para no cometer.
 *
 * Los castigos son duros y acumulativos porque son la señal más predictiva que hay: un castigo de
 * cartera pesa más que cualquier cosa buena que se pueda decir del cliente.
 */
export function paymentHistoryScore(input: RelationshipInput): number {
  if (input.onTimeRatio === null && input.loansSettled === 0 && input.loansActive === 0) return 50;

  const base = (input.onTimeRatio ?? 0.5) * 100;
  const dpdPenalty = input.worstDaysPastDue >= 90 ? 60 : input.worstDaysPastDue >= 30 ? 30 : input.worstDaysPastDue >= 1 ? 10 : 0;
  const chargeOffPenalty = input.chargeOffCount > 0 ? 70 : 0;
  const recentPenalty = Math.min(30, input.delinquencyCount12m * 10);

  return Math.round(clamp(base - dpdPenalty - chargeOffPenalty - recentPenalty, 0, 100));
}

/**
 * La fidelización, en puntos.
 *
 * No es «cuánto ha usado el producto» sino «cuántas veces ha completado el ciclo»: un crédito
 * cerrado sin castigo es la prueba de que la relación funciona en las dos direcciones. Los créditos
 * vivos suman menos que los cerrados —todavía no han terminado— y la relación dormida descuenta,
 * porque un cliente que no vuelve en un año no es un cliente fiel: es uno que se fue.
 */
export function loyaltyScore(input: RelationshipInput): number {
  const settled = Math.min(60, input.loansSettled * 20);
  const active = Math.min(20, input.loansActive * 10);
  const recency = input.monthsSinceLastLoan === null ? 0 : Math.round(clamp(1 - input.monthsSinceLastLoan / 12, 0, 1) * 20);
  return Math.round(clamp(settled + active + recency, 0, 100));
}
