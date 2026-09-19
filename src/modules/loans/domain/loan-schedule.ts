/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system genera el cronograma de amortización sin tocar base de datos ni reloj.
 */
import { roundCents, sumCents } from './money.util.js';

export type ScheduledInstallment = {
  installmentNumber: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
};

export type ScheduleInput = {
  principalCents: number;
  annualInterestRatePercent: number;
  termMonths: number;
  firstDueDate: Date;
};

/**
 * Suma meses conservando el día, y si ese día no existe en el mes destino cae al último.
 *
 * Un préstamo desembolsado el 31 de enero vence el 28 de febrero, no el 3 de marzo. `setMonth` de
 * JavaScript hace lo segundo en silencio, y el resultado es una cuota que se considera vencida
 * tres días tarde durante toda la vida del crédito.
 */
export function addMonthsClamped(base: Date, months: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const day = base.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth)));
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Cronograma francés: cuota constante, con el residuo del redondeo absorbido por la ÚLTIMA cuota.
 *
 * La regla que no se puede romper es que la suma de los capitales sea exactamente el capital
 * prestado. Repartir la cuota redondeando cada mes deja un desajuste de unos pocos céntimos que,
 * sin este cierre, aparece como un saldo residual imposible de cancelar: el préstamo nunca llega a
 * `paid_off` y el cliente recibe una gestión de cobranza por dos céntimos.
 *
 * Con tasa cero se reparte el capital en partes iguales — el caso del microcrédito sin interés y de
 * cualquier BNPL en cuotas, que no es una rareza sino el producto más común.
 */
export function buildSchedule(input: ScheduleInput): ScheduledInstallment[] {
  if (input.termMonths <= 0) throw new Error('El plazo debe ser de al menos un mes.');
  if (input.principalCents <= 0) throw new Error('El capital debe ser positivo.');

  const monthlyRate = input.annualInterestRatePercent / 100 / 12;
  const installments: ScheduledInstallment[] = [];
  let outstanding = input.principalCents;

  const payment =
    monthlyRate > 0
      ? roundCents((input.principalCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -input.termMonths)))
      : roundCents(input.principalCents / input.termMonths);

  for (let number = 1; number <= input.termMonths; number += 1) {
    const isLast = number === input.termMonths;
    const interest = monthlyRate > 0 ? roundCents(outstanding * monthlyRate) : 0;
    // La última cuota cancela lo que quede, sea cual sea el residuo acumulado por el redondeo.
    const principal = isLast ? outstanding : Math.min(Math.max(payment - interest, 0), outstanding);
    outstanding -= principal;
    installments.push({
      installmentNumber: number,
      dueDate: toDateOnly(addMonthsClamped(input.firstDueDate, number - 1)),
      principalCents: principal,
      interestCents: interest,
    });
  }

  const scheduledPrincipal = sumCents(installments.map((entry) => entry.principalCents));
  if (scheduledPrincipal !== input.principalCents) {
    // Invariante, no validación de entrada: si salta, el generador está mal, no los datos.
    throw new Error(`El cronograma reparte ${scheduledPrincipal} céntimos y el capital es ${input.principalCents}.`);
  }
  return installments;
}
