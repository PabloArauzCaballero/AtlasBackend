/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system recalcula mora y encola los desenlaces de cosecha que el motor necesita para recalibrarse.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { LoanInstallmentModel, LoanModel } from '../../../database/models/index.js';
import { bucketForDaysPastDue, loanDaysPastDue } from '../domain/loan-delinquency.js';
import { clampToZero, toCents } from '../domain/money.util.js';
import { amountForLabel, labelForLoan, OUTCOME_WINDOW_DAYS, windowIsMature, type InstallmentHistory } from '../domain/loan-outcome.js';
import { LoansRepository } from '../loans.repository.js';

/** Quién dice haber observado el desenlace. El motor lo guarda tal cual en `source`. */
export const OUTCOME_SOURCE = 'ATLAS_LOAN_BOOK';

const DAY_MS = 24 * 60 * 60 * 1000;

function outstandingCentsOf(installment: LoanInstallmentModel): number {
  return clampToZero(
    toCents(installment.principalAmount) +
      toCents(installment.interestAmount) +
      toCents(installment.lateFeeAmount) -
      toCents(installment.paidPrincipal) -
      toCents(installment.paidInterest) -
      toCents(installment.paidLateFee),
  );
}

@Injectable()
export class LoanDelinquencyService {
  private readonly logger = new Logger(LoanDelinquencyService.name);

  constructor(
    private readonly loans: LoansRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Barrido de mora y de cosechas.
   *
   * Dos trabajos en una pasada porque comparten la lectura cara —el cronograma de cada préstamo— y
   * porque el segundo depende del primero: la etiqueta del desenlace se deriva del atraso, así que
   * encolarla antes de recalcularlo produciría una observación fabricada con datos de ayer.
   */
  async sweep(input: { tenantId: string | null; limit: number; now?: Date }) {
    const now = input.now ?? new Date();
    const loans = await this.loans.findActiveLoansForSweep(input.tenantId, input.limit);
    let evaluated = 0;
    let enqueued = 0;

    for (const loan of loans) {
      try {
        const result = await this.sequelize.transaction((transaction) => this.evaluateLoan(loan, now, transaction));
        evaluated += 1;
        enqueued += result.enqueued;
      } catch (error) {
        // Un préstamo que falla no puede detener el barrido: el resto de la cartera sigue sin
        // evaluar y el dato de hoy no se recupera mañana.
        this.logger.error(`No se pudo evaluar el préstamo ${loan.id}: ${(error as Error).message}`);
      }
    }

    return { evaluated, enqueued, total: loans.length };
  }

  private async evaluateLoan(loan: LoanModel, now: Date, transaction: Transaction): Promise<{ enqueued: number }> {
    const locked = await this.loans.findLoanForUpdate(loan.tenantId, loan.id, transaction);
    if (!locked) return { enqueued: 0 };

    const installments = await this.loans.findInstallments(locked.tenantId, locked.id, { transaction });
    const open = installments.map((installment) => ({
      dueDate: installment.dueDate,
      outstandingCents: outstandingCentsOf(installment),
    }));

    const daysPastDue = loanDaysPastDue(open, now);
    const previousBucket = locked.delinquencyBucket;
    locked.daysPastDue = daysPastDue;
    locked.worstDaysPastDue = Math.max(locked.worstDaysPastDue, daysPastDue);
    locked.delinquencyBucket = locked.status === 'written_off' ? 'written_off' : bucketForDaysPastDue(daysPastDue);
    locked.delinquencyEvaluatedAt = now;
    locked.updatedAtValue = now;
    await locked.save({ transaction });

    // La cuota vencida e impaga se marca como tal: cobranza pregunta por estado, no por fecha.
    for (const installment of installments) {
      const outstanding = outstandingCentsOf(installment);
      if (outstanding > 0 && installment.dueDate < now.toISOString().slice(0, 10) && installment.status !== 'overdue') {
        installment.status = 'overdue';
        installment.daysPastDue = loanDaysPastDue([{ dueDate: installment.dueDate, outstandingCents: outstanding }], now);
        installment.updatedAtValue = now;
        await installment.save({ transaction });
      }
    }

    if (previousBucket !== locked.delinquencyBucket) {
      await this.loans.createEvent(
        {
          tenantId: locked.tenantId,
          loanId: locked.id,
          eventType: 'delinquency_bucket_changed',
          previousStatus: previousBucket,
          newStatus: locked.delinquencyBucket,
          actorType: 'system',
          payloadJson: { daysPastDue },
          happenedAt: now,
        },
        { transaction },
      );
    }

    const enqueued = await this.enqueueMatureOutcomes(locked, installments, now, transaction);
    return { enqueued };
  }

  /**
   * Encola una observación por cada ventana de cosecha ya cumplida.
   *
   * El corte se calcula sobre la fecha de la DECISIÓN, no sobre hoy: una ventana de 90 días mide lo
   * que pasó en los 90 días siguientes a decidir, y evaluarla con datos posteriores contaminaría la
   * medida con información que el modelo no podía tener.
   *
   * Sin `decision_execution_id` no se encola nada: una observación que el motor no puede atribuir a
   * ninguna ejecución no mide el desempeño de ninguna versión.
   */
  private async enqueueMatureOutcomes(
    loan: LoanModel,
    installments: readonly LoanInstallmentModel[],
    now: Date,
    transaction: Transaction,
  ): Promise<number> {
    if (!loan.decisionExecutionId) return 0;
    const decisionAt = loan.disbursedAt ?? loan.createdAtValue;
    if (!decisionAt) return 0;

    const history: InstallmentHistory[] = installments.map((installment) => ({
      dueDate: installment.dueDate,
      settledAt: installment.settledAt,
      outstandingCents: outstandingCentsOf(installment),
    }));

    let enqueued = 0;
    for (const windowDays of OUTCOME_WINDOW_DAYS) {
      if (!windowIsMature(decisionAt, windowDays, now)) continue;
      const existing = await this.loans.findOutcomeReport(loan.tenantId, loan.id, windowDays, { transaction });
      if (existing) continue;

      const asOf = new Date(decisionAt.getTime() + windowDays * DAY_MS);
      const input = { installments: history, writtenOffAt: loan.writtenOffAt, asOf };
      const label = labelForLoan(input);
      await this.loans.createOutcomeReport(
        {
          tenantId: loan.tenantId,
          loanId: loan.id,
          decisionExecutionId: loan.decisionExecutionId,
          windowDays,
          label,
          amount: String(amountForLabel(label, input, toCents(loan.outstandingPrincipal))),
          source: OUTCOME_SOURCE,
          status: 'pending',
          observedAt: asOf,
        },
        { transaction },
      );
      enqueued += 1;
    }
    return enqueued;
  }
}
