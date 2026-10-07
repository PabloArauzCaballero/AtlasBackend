/**
 * @file La sonda con que se pide la línea y la tasa que se guarda en ella.
 * @business La línea se mide con lo que el cliente podrá gastar, y muestra la tasa que de verdad se cobra.
 * @system funciones puras del recálculo de la línea (`credit-line-recalculation.service.ts`).
 */
import { env } from '../../../config/env.js';
import { DEFAULT_CAPACITY_POLICY } from '../domain/payment-capacity.js';

/** La sonda de la línea: lo que la capacidad propone, o el mínimo útil si no propone nada. */
export function lineProbeAmount(capacity: { recommendedLimit: number }): number {
  return capacity.recommendedLimit > 0 ? capacity.recommendedLimit : DEFAULT_CAPACITY_POLICY.minimumUsefulLimit;
}

/** La tasa que se guarda en la línea, recortada al tope de usura igual que en el desembolso (`loan-disbursement-rate.ts`). */
export function lineRateWithinUsuryCap(ratePercent: number | null, usuryCapRate: number = env.USURY_CAP_RATE): number | null {
  if (ratePercent === null) return null;
  return Math.min(ratePercent, usuryCapRate * 100);
}
