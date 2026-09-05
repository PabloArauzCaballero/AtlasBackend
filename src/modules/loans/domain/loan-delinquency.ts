/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system deriva días de atraso y tramo de mora sin tocar base de datos ni reloj del sistema.
 */

export const DELINQUENCY_BUCKETS = ['current', 'dpd_1_29', 'dpd_30_59', 'dpd_60_89', 'dpd_90_plus', 'written_off'] as const;

export type DelinquencyBucket = (typeof DELINQUENCY_BUCKETS)[number];

export type OpenInstallment = {
  dueDate: string;
  outstandingCents: number;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Días de atraso entre dos fechas, contados por DÍA DE CALENDARIO en UTC.
 *
 * Restar milisegundos y dividir parece equivalente y no lo es: con horas distintas, un vencimiento
 * de ayer a las 23:00 mirado hoy a las 08:00 da 0 días y no 1. La mora se cuenta en días del
 * calendario, así que ambas fechas se truncan antes de restar.
 */
export function daysBetween(dueDate: string, asOf: Date): number {
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  if (!Number.isFinite(due)) throw new Error(`Fecha de vencimiento inválida: ${dueDate}`);
  return Math.floor((today - due) / MILLISECONDS_PER_DAY);
}

/**
 * Días de atraso del PRÉSTAMO: los de su cuota impaga más antigua.
 *
 * No es el promedio ni el de la última: mientras exista una cuota vieja sin cubrir, el préstamo
 * está tan atrasado como ella. Un cliente que paga la cuota de este mes y deja debiendo la de hace
 * tres sigue con 90 días de mora, y cualquier otra lectura le regalaría un tramo mejor del que
 * tiene.
 */
export function loanDaysPastDue(installments: readonly OpenInstallment[], asOf: Date): number {
  const overdue = installments
    .filter((installment) => installment.outstandingCents > 0)
    .map((installment) => daysBetween(installment.dueDate, asOf))
    .filter((days) => days > 0);
  return overdue.length === 0 ? 0 : Math.max(...overdue);
}

export function bucketForDaysPastDue(daysPastDue: number): DelinquencyBucket {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue < 30) return 'dpd_1_29';
  if (daysPastDue < 60) return 'dpd_30_59';
  if (daysPastDue < 90) return 'dpd_60_89';
  return 'dpd_90_plus';
}
