/**
 * @file Estado de las cuotas que cambia por mora o por reverso de un cobro.
 * @business Cobranza pregunta por el estado de la cuota, no por su fecha: tiene que reflejar lo que de verdad se debe.
 * @system funciones puras sobre modelos ya cargados; el llamador guarda dentro de su transacción.
 */
import type { Transaction } from 'sequelize';
import type { LoanInstallmentModel } from '../../../database/models/index.js';
import { civilDateOf, loanDaysPastDue } from '../domain/loan-delinquency.js';
import { clampToZero, toCents } from '../domain/money.util.js';

export function outstandingCentsOf(installment: LoanInstallmentModel): number {
  return clampToZero(
    toCents(installment.principalAmount) +
      toCents(installment.interestAmount) +
      toCents(installment.lateFeeAmount) -
      toCents(installment.paidPrincipal) -
      toCents(installment.paidInterest) -
      toCents(installment.paidLateFee),
  );
}

/**
 * La cuota vencida e impaga se marca `overdue` y su atraso se recalcula en cada pasada, no sólo al
 * entrar en mora: si no, se quedaba en 1 día.
 *
 * Las `written_off` y las pagadas no se tocan: el castigo pone en `written_off` las cuotas impagas sin
 * cambiar sus importes, así que siguen con saldo y fecha pasada; sin este corte el primer barrido las
 * volvía `overdue` y el castigo desaparecía del calendario y de las cuotas cobrables.
 */
export async function markOverdueInstallments(installments: LoanInstallmentModel[], now: Date, transaction: Transaction): Promise<void> {
  const today = civilDateOf(now);
  for (const installment of installments) {
    if (installment.status === 'written_off' || installment.status === 'paid') continue;
    const outstanding = outstandingCentsOf(installment);
    if (outstanding <= 0 || installment.dueDate >= today) continue;
    const installmentDaysPastDue = loanDaysPastDue([{ dueDate: installment.dueDate, outstandingCents: outstanding }], now);
    if (installment.status === 'overdue' && installment.daysPastDue === installmentDaysPastDue) continue;
    installment.status = 'overdue';
    installment.daysPastDue = installmentDaysPastDue;
    installment.updatedAtValue = now;
    await installment.save({ transaction });
  }
}

/**
 * Estado de la cuota tras restarle un cobro: se DERIVA de lo que queda pagado. Dejarla siempre en
 * `partially_paid` mostraba como pago parcial una cuota con cero pagado, y una `written_off` no se toca.
 */
export function statusAfterReversal(installment: LoanInstallmentModel, now: Date, fullyPaid: boolean): LoanInstallmentModel['status'] {
  if (installment.status === 'written_off') return installment.status;
  if (fullyPaid) return 'paid';
  const paidCents = toCents(installment.paidPrincipal) + toCents(installment.paidInterest) + toCents(installment.paidLateFee);
  if (paidCents > 0) return 'partially_paid';
  return installment.dueDate < civilDateOf(now) ? 'overdue' : 'pending';
}
