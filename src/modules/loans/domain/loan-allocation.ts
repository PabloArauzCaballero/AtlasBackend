/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system reparte un cobro entre cuotas y conceptos de forma determinista y reconstruible.
 */
import { clampToZero } from './money.util.js';

export type AllocatableInstallment = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalDueCents: number;
  interestDueCents: number;
  lateFeeDueCents: number;
};

export type InstallmentAllocation = {
  installmentId: string;
  principalCents: number;
  interestCents: number;
  lateFeeCents: number;
};

export type AllocationResult = {
  allocations: InstallmentAllocation[];
  /** Lo que sobra tras cubrir todo lo pendiente. Se devuelve; nunca se queda flotando. */
  unappliedCents: number;
};

/**
 * Prelación del cobro: cuota más antigua primero y, dentro de ella, mora → interés → capital.
 *
 * El orden no es una preferencia estética, es la diferencia entre un cliente que sale de la mora y
 * uno que no. Aplicar primero a capital deja los intereses vencidos vivos, así que la cuota más
 * antigua sigue impaga, los días de atraso siguen corriendo y el cliente que pagó lo que debía
 * aparece igual de moroso al día siguiente.
 *
 * Un pago que excede lo pendiente NO se aplica a cuotas futuras por iniciativa propia: se devuelve
 * como `unappliedCents` para que quien registró el cobro decida. Adelantar cuotas cambia el interés
 * devengado y es una decisión del producto, no del repartidor de céntimos.
 */
export function allocatePayment(amountCents: number, installments: readonly AllocatableInstallment[]): AllocationResult {
  if (amountCents <= 0) throw new Error('El importe del cobro debe ser positivo.');

  const ordered = [...installments].sort((left, right) => {
    if (left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
    return left.installmentNumber - right.installmentNumber;
  });

  let remaining = amountCents;
  const allocations: InstallmentAllocation[] = [];

  for (const installment of ordered) {
    if (remaining <= 0) break;

    const lateFee = Math.min(remaining, clampToZero(installment.lateFeeDueCents));
    remaining -= lateFee;
    const interest = Math.min(remaining, clampToZero(installment.interestDueCents));
    remaining -= interest;
    const principal = Math.min(remaining, clampToZero(installment.principalDueCents));
    remaining -= principal;

    if (lateFee + interest + principal > 0) {
      allocations.push({
        installmentId: installment.id,
        principalCents: principal,
        interestCents: interest,
        lateFeeCents: lateFee,
      });
    }
  }

  return { allocations, unappliedCents: remaining };
}
