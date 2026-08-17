/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system aplica y reversa cobros contra el cronograma bajo bloqueo, manteniendo el saldo reconstruible.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { createStableCode, sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { LoanInstallmentModel, LoanModel } from '../../../database/models/index.js';
import { allocatePayment, type AllocatableInstallment } from '../domain/loan-allocation.js';
import { clampToZero, fromCents, toCents } from '../domain/money.util.js';
import { RegisterPaymentDto, ReversePaymentDto } from '../loans.schemas.js';
import { LoansRepository } from '../loans.repository.js';

function outstandingOf(installment: LoanInstallmentModel): AllocatableInstallment {
  return {
    id: installment.id,
    installmentNumber: installment.installmentNumber,
    dueDate: installment.dueDate,
    principalDueCents: clampToZero(toCents(installment.principalAmount) - toCents(installment.paidPrincipal)),
    interestDueCents: clampToZero(toCents(installment.interestAmount) - toCents(installment.paidInterest)),
    lateFeeDueCents: clampToZero(toCents(installment.lateFeeAmount) - toCents(installment.paidLateFee)),
  };
}

function isFullyPaid(installment: LoanInstallmentModel): boolean {
  const pending = outstandingOf(installment);
  return pending.principalDueCents + pending.interestDueCents + pending.lateFeeDueCents === 0;
}

@Injectable()
export class LoanPaymentService {
  constructor(
    private readonly loans: LoansRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Registrar un cobro y aplicarlo al cronograma.
   *
   * El préstamo y sus cuotas se bloquean (`FOR UPDATE`) antes de calcular nada. Sin ese bloqueo dos
   * cobros simultáneos leen el mismo saldo, cada uno reparte sobre él y el segundo pisa al primero:
   * entra dinero dos veces y la deuda baja una sola.
   *
   * Un cobro que excede lo pendiente se rechaza en vez de aplicarse a medias. El excedente es una
   * decisión de producto —¿prepago, saldo a favor, devolución?— y adivinarla aquí sería inventar
   * política de negocio dentro de un repartidor de céntimos.
   */
  async registerPayment(input: {
    tenantId: string;
    loanId: string;
    body: RegisterPaymentDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    const idempotencyKeyHash = sha256Hex(input.idempotencyKey);

    return this.sequelize.transaction(async (transaction) => {
      const duplicate = await this.loans.findPaymentByIdempotency(input.tenantId, idempotencyKeyHash, { transaction });
      // La pasarela reintenta; el cobro no puede aplicarse dos veces por eso.
      if (duplicate) return { paymentId: duplicate.id, paymentCode: duplicate.paymentCode, duplicated: true };

      const loan = await this.loans.findLoanForUpdate(input.tenantId, input.loanId, transaction);
      if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
      if (loan.status !== 'active') throw new ConflictException('LOAN_NOT_COLLECTABLE');
      if (loan.currencyCode !== input.body.currencyCode) throw new UnprocessableEntityException('CURRENCY_MISMATCH');

      const installments = await this.loans.findCollectableInstallments(input.tenantId, loan.id, transaction);
      const amountCents = toCents(input.body.amount);
      const result = allocatePayment(amountCents, installments.map(outstandingOf));
      if (result.unappliedCents > 0) throw new UnprocessableEntityException('PAYMENT_EXCEEDS_OUTSTANDING');

      const receivedAt = input.body.receivedAt ? new Date(input.body.receivedAt) : new Date();
      const payment = await this.loans.createPayment(
        {
          tenantId: input.tenantId,
          loanId: loan.id,
          paymentCode: createStableCode('PAY'),
          amount: fromCents(amountCents),
          currencyCode: input.body.currencyCode,
          paymentMethod: input.body.paymentMethod,
          externalReference: input.body.externalReference ?? null,
          receivedAt,
          status: 'applied',
          registeredByInternalUserId: input.currentUser.internalUserId ?? null,
          idempotencyKeyHash,
        },
        { transaction },
      );

      await this.loans.bulkCreateAllocations(
        result.allocations.map((allocation) => ({
          tenantId: input.tenantId,
          loanPaymentId: payment.id,
          loanInstallmentId: allocation.installmentId,
          principalApplied: fromCents(allocation.principalCents),
          interestApplied: fromCents(allocation.interestCents),
          lateFeeApplied: fromCents(allocation.lateFeeCents),
        })),
        { transaction },
      );

      const byId = new Map(installments.map((installment) => [installment.id, installment]));
      for (const allocation of result.allocations) {
        const installment = byId.get(allocation.installmentId);
        if (!installment) continue;
        installment.paidPrincipal = fromCents(toCents(installment.paidPrincipal) + allocation.principalCents);
        installment.paidInterest = fromCents(toCents(installment.paidInterest) + allocation.interestCents);
        installment.paidLateFee = fromCents(toCents(installment.paidLateFee) + allocation.lateFeeCents);
        const settled = isFullyPaid(installment);
        installment.status = settled ? 'paid' : 'partially_paid';
        installment.settledAt = settled ? receivedAt : null;
        installment.updatedAtValue = receivedAt;
        await installment.save({ transaction });
      }

      await this.applyTotalsToLoan(loan, transaction, receivedAt);

      await this.loans.createEvent(
        {
          tenantId: input.tenantId,
          loanId: loan.id,
          eventType: 'payment_applied',
          previousStatus: 'active',
          newStatus: loan.status,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          payloadJson: { paymentCode: payment.paymentCode, amount: fromCents(amountCents) },
          happenedAt: receivedAt,
        },
        { transaction },
      );

      return { paymentId: payment.id, paymentCode: payment.paymentCode, duplicated: false, loanStatus: loan.status };
    });
  }

  /**
   * Reversar un cobro: un cheque devuelto, un contracargo, un error de caja.
   *
   * Se deshace leyendo las asignaciones que ese pago produjo y restándolas, no recalculando el
   * saldo desde cero. Por eso existe `loan_payment_allocations`: sin ella habría que adivinar de
   * qué cuota y de qué concepto salió cada céntimo, y la adivinanza sería distinta según el orden
   * en que se hubieran registrado los cobros posteriores.
   */
  async reversePayment(input: {
    tenantId: string;
    loanId: string;
    paymentId: string;
    body: ReversePaymentDto;
    currentUser: AuthenticatedUser;
  }) {
    return this.sequelize.transaction(async (transaction) => {
      const loan = await this.loans.findLoanForUpdate(input.tenantId, input.loanId, transaction);
      if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');

      const payment = await this.loans.findPaymentForUpdate(input.tenantId, input.paymentId, transaction);
      if (!payment || payment.loanId !== loan.id) throw new NotFoundException('LOAN_PAYMENT_NOT_FOUND');
      if (payment.status === 'reversed') throw new ConflictException('LOAN_PAYMENT_ALREADY_REVERSED');

      const allocations = await this.loans.findAllocationsByPayment(input.tenantId, payment.id, { transaction });
      const installments = await this.loans.findInstallments(input.tenantId, loan.id, { transaction });
      const byId = new Map(installments.map((installment) => [installment.id, installment]));
      const now = new Date();

      for (const allocation of allocations) {
        const installment = byId.get(allocation.loanInstallmentId);
        if (!installment) continue;
        installment.paidPrincipal = fromCents(clampToZero(toCents(installment.paidPrincipal) - toCents(allocation.principalApplied)));
        installment.paidInterest = fromCents(clampToZero(toCents(installment.paidInterest) - toCents(allocation.interestApplied)));
        installment.paidLateFee = fromCents(clampToZero(toCents(installment.paidLateFee) - toCents(allocation.lateFeeApplied)));
        installment.status = isFullyPaid(installment) ? 'paid' : 'partially_paid';
        if (installment.status !== 'paid') installment.settledAt = null;
        installment.updatedAtValue = now;
        await installment.save({ transaction });
        allocation.reversed = true;
        await allocation.save({ transaction });
      }

      payment.status = 'reversed';
      payment.reversedAt = now;
      payment.reversalReasonCode = input.body.reasonCode;
      payment.updatedAtValue = now;
      await payment.save({ transaction });

      await this.applyTotalsToLoan(loan, transaction, now);

      await this.loans.createEvent(
        {
          tenantId: input.tenantId,
          loanId: loan.id,
          eventType: 'payment_reversed',
          previousStatus: loan.status,
          newStatus: loan.status,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reasonCode: input.body.reasonCode,
          payloadJson: { paymentCode: payment.paymentCode, amount: payment.amount },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );

      return { paymentId: payment.id, status: payment.status, loanStatus: loan.status };
    });
  }

  /**
   * Recalcula los acumulados del préstamo desde SUS CUOTAS, no sumando movimientos.
   *
   * Es la diferencia entre un saldo que se puede auditar y uno que sólo se puede creer: el
   * cronograma es la verdad, y el total del préstamo es su suma. Un contador incrementado a cada
   * cobro se desvía en el primer reverso mal aplicado y nadie se entera hasta el cierre.
   */
  private async applyTotalsToLoan(loan: LoanModel, transaction: Transaction, now: Date): Promise<void> {
    const installments = await this.loans.findInstallments(loan.tenantId, loan.id, { transaction });
    const paidPrincipal = installments.reduce((total, entry) => total + toCents(entry.paidPrincipal), 0);
    const paidInterest = installments.reduce((total, entry) => total + toCents(entry.paidInterest), 0);
    const paidLateFee = installments.reduce((total, entry) => total + toCents(entry.paidLateFee), 0);
    const scheduledPrincipal = installments.reduce((total, entry) => total + toCents(entry.principalAmount), 0);

    loan.paidPrincipal = fromCents(paidPrincipal);
    loan.paidInterest = fromCents(paidInterest);
    loan.paidLateFee = fromCents(paidLateFee);
    loan.outstandingPrincipal = fromCents(clampToZero(scheduledPrincipal - paidPrincipal));
    loan.updatedAtValue = now;

    const everythingSettled = installments.every((entry) => isFullyPaid(entry));
    if (everythingSettled && loan.status === 'active') {
      loan.status = 'paid_off';
      loan.closedAt = now;
      loan.daysPastDue = 0;
      loan.delinquencyBucket = 'current';
    } else if (!everythingSettled && loan.status === 'paid_off') {
      // Un reverso puede reabrir un préstamo que se dio por cancelado.
      loan.status = 'active';
      loan.closedAt = null;
    }
    await loan.save({ transaction });
  }
}
