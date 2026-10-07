/**
 * @file Contra qué ingreso se mide la cuota, y la deuda-ingreso que sale de él.
 * @business El ingreso verificado en la cuenta manda sobre el declarado en el formulario.
 * @system funciones puras que comparten las variables del underwriting y el recálculo de la línea.
 */
import type { StatementSignals } from './underwriting-statement.service.js';

/**
 * Sale de `underwriting-features.service.ts` para dejarlo bajo el límite de `check:file-size`, y porque el recálculo
 * de la línea necesita la misma cuenta (`affordabilityRatioFor`) con la sonda real.
 */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Del vocabulario del alta al del artefacto. Lo que no encaje, o falte, va a `UNKNOWN` (artefacto 2.2.0): hasta
 * 2026-10 iba a `UNEMPLOYED`, que suma 60 puntos, y un dato no declarado se leía como el peor posible. Por la misma
 * razón `underwriting-features.service.ts` manda `income_stability_score = 50` sin antigüedad, y no 0 (25 puntos).
 */
export const EMPLOYMENT_MAP: Record<string, string> = {
  employee: 'EMPLOYED',
  employed: 'EMPLOYED',
  self_employed: 'SELF_EMPLOYED',
  independent: 'SELF_EMPLOYED',
  business_owner: 'SELF_EMPLOYED',
  retired: 'RETIRED',
  student: 'STUDENT',
  unemployed: 'UNEMPLOYED',
};

/** Cuota / ingreso, acotada a [0, 5] y a tres decimales. Sin ingreso, 5: no hay con qué pagar. */
export function affordabilityRatioFor(monthlyInstalment: number, income: number): number {
  return income > 0 ? Math.round(clamp(monthlyInstalment / income, 0, 5) * 1000) / 1000 : 5;
}

/**
 * El ingreso de referencia y los dos ratios.
 *
 * Con extracto vigente: el ingreso reconocido por el worker y, para la deuda, las obligaciones observadas en la cuenta
 * más la cuota de Atlas. Sin él: lo declarado, y la deuda sólo se conoce si se declararon gastos.
 */
export function incomeBasis(input: {
  extracto: StatementSignals;
  monthlyInstalment: number;
  declaredIncome: number;
  expenses: number;
  expensesKnown: boolean;
  monthlyCommitted: number;
}): { verified: number; affordabilityIncome: number; affordabilityRatio: number; debtKnown: boolean; debtToIncome: number } {
  const verified = input.extracto.available ? (input.extracto.verifiedMonthlyIncome ?? 0) : 0;
  const affordabilityIncome = verified > 0 ? verified : input.declaredIncome;
  const debtToIncome =
    verified > 0
      ? clamp(((input.extracto.monthlyObligations ?? 0) + input.monthlyCommitted) / verified, 0, 5)
      : input.declaredIncome > 0
        ? clamp((input.expenses + input.monthlyCommitted) / input.declaredIncome, 0, 5)
        : 5;
  return {
    verified,
    affordabilityIncome,
    affordabilityRatio: affordabilityRatioFor(input.monthlyInstalment, affordabilityIncome),
    debtKnown: verified > 0 || input.expensesKnown,
    debtToIncome,
  };
}
