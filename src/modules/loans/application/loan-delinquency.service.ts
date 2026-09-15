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
import { CreditLineService } from '../../credit/application/credit-line.service.js';
import { LoansRepository } from '../loans.repository.js';

/** Quién dice haber observado el desenlace. El motor lo guarda tal cual en `source`. */
export const OUTCOME_SOURCE = 'ATLAS_LOAN_BOOK';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Orden de gravedad de los tramos de mora.
 *
 * Hace falta para saber si el préstamo EMPEORÓ o MEJORÓ, que no es lo mismo de cara al cliente: una
 * es «entraste en mora y te cuesta capacidad de pago» y la otra «te pusiste al día y la recuperas».
 * El recálculo es el mismo; lo que cambia es el motivo que queda escrito en el historial, y ese
 * motivo es justo lo que la persona lee cuando pregunta por qué le movieron el límite.
 */
const BUCKET_RANK: Record<string, number> = {
  current: 0,
  dpd_1_29: 1,
  dpd_30_59: 2,
  dpd_60_89: 3,
  dpd_90_plus: 4,
  written_off: 5,
};

function rankOf(bucket: string): number {
  return BUCKET_RANK[bucket] ?? 0;
}

/** Lo que el barrido necesita saber de cada préstamo para decidir a quién recalcularle la línea. */
type EvaluationResult = {
  enqueued: number;
  bucketChange: { tenantId: string; customerId: string; worsened: boolean } | null;
};

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
    private readonly creditLines: CreditLineService,
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

    /*
     * Un cliente puede tener varios préstamos y moverse de tramo en más de uno en la misma pasada.
     * Se le recalcula la línea UNA vez: el motor mira su expediente entero, así que pedirlo dos
     * veces devolvería lo mismo y abriría dos versiones del historial para un solo hecho. Si alguno
     * empeoró, el motivo es la mora aunque otro haya mejorado — lo que manda es lo peor que le pasó.
     */
    const affected = new Map<string, { tenantId: string; customerId: string; worsened: boolean }>();

    for (const loan of loans) {
      try {
        const result = await this.sequelize.transaction((transaction) => this.evaluateLoan(loan, now, transaction));
        evaluated += 1;
        enqueued += result.enqueued;
        if (result.bucketChange) {
          // La clave lleva el tenant: el barrido puede correr sobre toda la instalación, y dos
          // tenants distintos pueden tener el mismo identificador de cliente.
          const key = `${result.bucketChange.tenantId}:${result.bucketChange.customerId}`;
          const previous = affected.get(key);
          affected.set(key, {
            tenantId: result.bucketChange.tenantId,
            customerId: result.bucketChange.customerId,
            worsened: (previous?.worsened ?? false) || result.bucketChange.worsened,
          });
        }
      } catch (error) {
        // Un préstamo que falla no puede detener el barrido: el resto de la cartera sigue sin
        // evaluar y el dato de hoy no se recupera mañana.
        this.logger.error(`No se pudo evaluar el préstamo ${loan.id}: ${(error as Error).message}`);
      }
    }

    const recalculated = await this.refreshCreditLines(affected);
    return { evaluated, enqueued, total: loans.length, recalculated };
  }

  /**
   * Traslada el cambio de mora a la capacidad de pago.
   *
   * Es la mitad que faltaba. El barrido ya sabía que alguien había entrado en mora —lo escribía en
   * `delinquency_bucket` y lo dejaba ahí—, pero la línea de crédito seguía siendo la que se calculó
   * el día del alta. El cliente veía su cuota vencida y, al lado, el mismo límite aprobado de
   * siempre: la mora no costaba nada visible, que es exactamente lo contrario de lo que el producto
   * dice que pasa.
   *
   * Corre FUERA de la transacción del préstamo y tolera fallos uno a uno: el motor es un servicio
   * remoto, y que no responda por un cliente no puede dejar sin evaluar al resto de la cartera ni
   * revertir un barrido de mora que ya es correcto.
   */
  private async refreshCreditLines(affected: Map<string, { tenantId: string; customerId: string; worsened: boolean }>): Promise<number> {
    let recalculated = 0;
    for (const change of affected.values()) {
      try {
        const line = await this.creditLines.recalculate({
          tenantId: change.tenantId,
          customerId: change.customerId,
          trigger: change.worsened ? 'delinquency' : 'repayment',
        });
        if (line) recalculated += 1;
      } catch (error) {
        this.logger.error(`No se pudo recalcular la línea del cliente ${change.customerId}: ${(error as Error).message}`);
      }
    }
    return recalculated;
  }

  private async evaluateLoan(loan: LoanModel, now: Date, transaction: Transaction): Promise<EvaluationResult> {
    const locked = await this.loans.findLoanForUpdate(loan.tenantId, loan.id, transaction);
    if (!locked) return { enqueued: 0, bucketChange: null };

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
          /*
           * `_created_at` tiene DEFAULT en la base pero el modelo lo declara `allowNull: false` sin
           * `defaultValue`, así que Sequelize valida ANTES de preguntar y la escritura moría.
           *
           * El efecto era peor de lo que parece. Este evento se escribe SÓLO cuando cambia el tramo
           * de mora —es decir, exactamente cuando un préstamo entra en mora—, y el fallo se lo
           * tragaba el `catch` que protege el barrido de un préstamo roto. Resultado: el barrido
           * informaba de su corrida, el préstamo recién vencido se quedaba con `days_past_due = 0` y
           * el único rastro era una línea de log. La cartera que entraba en mora era invisible.
           */
          createdAtValue: now,
        },
        { transaction },
      );
    }

    const enqueued = await this.enqueueMatureOutcomes(locked, installments, now, transaction);
    /*
     * El cambio de tramo se DEVUELVE en lugar de recalcular la línea aquí mismo, y no por estilo: la
     * transacción tiene el préstamo bloqueado con `FOR UPDATE`, y meter dentro una llamada de red al
     * motor mantendría ese bloqueo abierto durante toda la latencia del motor —y lo perdería todo si
     * el motor tarda de más. El recálculo va después, fuera del `commit`.
     */
    return {
      enqueued,
      bucketChange:
        previousBucket === locked.delinquencyBucket
          ? null
          : {
              tenantId: locked.tenantId,
              customerId: locked.customerId,
              worsened: rankOf(locked.delinquencyBucket) > rankOf(previousBucket),
            },
    };
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
          // Mismo motivo que el evento de tramo: el modelo lo exige y la base no llega a ponerlo.
          createdAtValue: asOf,
        },
        { transaction },
      );
      enqueued += 1;
    }
    return enqueued;
  }
}
