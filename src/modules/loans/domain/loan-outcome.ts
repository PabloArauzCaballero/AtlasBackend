/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system deriva la etiqueta de desenlace que el motor de decisión necesita para recalibrarse.
 */
import { daysBetween } from './loan-delinquency.js';

export const OUTCOME_LABELS = ['GOOD', 'BAD', 'REJECTED_WOULD_HAVE_BEEN_GOOD', 'REJECTED_CONFIRMED_BAD', 'INDETERMINATE'] as const;

export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

/**
 * Ventanas de cosecha, en días desde la decisión.
 *
 * Tres y no una porque miden cosas distintas: 30 detecta el fraude de primera cuota, 90 es la
 * definición estándar de incumplimiento, y 180 es donde una cartera de microcrédito termina de
 * madurar. El motor las guarda por separado (`window_days` forma parte de la identidad de la
 * observación), así que enviarlas todas no duplica nada.
 */
export const OUTCOME_WINDOW_DAYS = [30, 90, 180] as const;

/** Umbral de «malo». 90+ días de atraso es la definición que usa el resto de la industria. */
export const BAD_DAYS_PAST_DUE = 90;

/** Zona gris: ni bueno ni malo. Por debajo empieza el bueno. */
export const INDETERMINATE_DAYS_PAST_DUE = 30;

export type InstallmentHistory = {
  dueDate: string;
  /** Cuándo quedó saldada. `null` = sigue abierta. */
  settledAt: Date | null;
  outstandingCents: number;
};

export type OutcomeInput = {
  installments: readonly InstallmentHistory[];
  writtenOffAt: Date | null;
  /** Corte de la ventana: fecha de la decisión más `windowDays`. */
  asOf: Date;
};

/**
 * El PEOR atraso vivido hasta el corte de la ventana.
 *
 * Una cuota ya saldada aporta el atraso que tuvo cuando se pagó, no cero: un cliente que pagó todo
 * con 120 días de retraso no es un buen cliente, y mirar sólo el estado presente lo blanquearía. Es
 * el error que convierte una cartera mala en una que parece sana.
 */
export function worstDaysPastDue(input: OutcomeInput): number {
  let worst = 0;
  for (const installment of input.installments) {
    const settledWithinWindow = installment.settledAt !== null && installment.settledAt <= input.asOf;
    const reference = settledWithinWindow ? (installment.settledAt as Date) : input.asOf;
    // Una cuota que vence DESPUÉS del corte todavía no puede estar atrasada.
    const days = daysBetween(installment.dueDate, reference);
    if (days > worst) worst = days;
  }
  return worst;
}

/**
 * Etiqueta del desenlace de un préstamo desembolsado, al corte de una ventana.
 *
 * `INDETERMINATE` no es un descarte perezoso: es la respuesta correcta para la zona gris de 30 a 89
 * días. El motor la cuenta como observada y la deja FUERA de todos los denominadores, porque meter
 * «no se sabe» dentro de «salió bien» es la forma más silenciosa de inflar el acierto de un modelo.
 */
export function labelForLoan(input: OutcomeInput): OutcomeLabel {
  if (input.writtenOffAt !== null && input.writtenOffAt <= input.asOf) return 'BAD';
  const worst = worstDaysPastDue(input);
  if (worst >= BAD_DAYS_PAST_DUE) return 'BAD';
  if (worst >= INDETERMINATE_DAYS_PAST_DUE) return 'INDETERMINATE';
  return 'GOOD';
}

/**
 * Magnitud que acompaña a la etiqueta: lo que se perdió, o cuánto se tardó.
 *
 * El motor la guarda sin imponerle unidad (`amount`), así que se manda lo que hace comparable a dos
 * observaciones de la misma etiqueta: en un malo, el capital expuesto; en el resto, los días de
 * atraso. Sin esto, dos «BAD» de 50 y de 5 000 pesan igual al recalibrar.
 */
export function amountForLabel(label: OutcomeLabel, input: OutcomeInput, outstandingPrincipalCents: number): number {
  if (label === 'BAD') return outstandingPrincipalCents / 100;
  return worstDaysPastDue(input);
}

/**
 * Si la ventana ya cumplió. Una observación enviada antes de tiempo es peor que ninguna: el motor
 * la guarda como definitiva —`window_days` es clave única— y ya no la vuelve a preguntar.
 */
export function windowIsMature(decisionAt: Date, windowDays: number, now: Date): boolean {
  const matureAt = new Date(decisionAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return now >= matureAt;
}
