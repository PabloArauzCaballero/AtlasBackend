/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza reúne todo lo que Atlas sabe del cliente para proponer cuánto crédito soporta.
 * @system arma las entradas del modelo de capacidad desde el expediente y delega el cálculo al dominio.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  BankStatementReviewModel,
  CustomerActivitySummaryModel,
  CustomerModel,
  IdentityVerificationAttemptModel,
  LoanInstallmentModel,
  LoanModel,
} from '../../../database/models/index.js';
import {
  assessPaymentCapacity,
  type PaymentCapacityAssessment,
  type RelationshipInput,
  type StatementCapacityInput,
} from '../domain/payment-capacity.js';

/**
 * La propuesta de límite, armada con el expediente real.
 *
 * ## Por qué es un servicio y no una consulta más dentro del recálculo de línea
 *
 * Porque la propuesta se consulta desde tres sitios que no comparten camino: el recálculo de la
 * línea, la pantalla del cliente —que enseña por qué su límite es ése y qué lo subiría— y el
 * portal de operaciones. Con la lógica dentro del recálculo, las otras dos tendrían que
 * reproducirla y las tres acabarían diciendo cifras distintas del mismo cliente.
 *
 * ## Qué NO hace
 *
 * No escribe nada y no decide nada. Lee, arma las entradas del modelo y devuelve una propuesta con
 * su desglose. Quien la convierte en un límite es el artefacto del motor, que es donde vive la
 * política; aquí sólo se mide.
 */
@Injectable()
export class PaymentCapacityService {
  constructor(
    @InjectModel(CustomerModel) private readonly customers: typeof CustomerModel,
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    @InjectModel(LoanInstallmentModel) private readonly installments: typeof LoanInstallmentModel,
    @InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel,
    @InjectModel(CustomerActivitySummaryModel) private readonly activity: typeof CustomerActivitySummaryModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identity: typeof IdentityVerificationAttemptModel,
  ) {}

  async assess(input: {
    tenantId: string;
    customerId: string;
    declaredMonthlyIncome: number | null;
    currentLimit: number | null;
    termMonths?: number;
    now?: Date;
  }): Promise<PaymentCapacityAssessment> {
    const now = input.now ?? new Date();
    const [statement, relationship] = await Promise.all([
      this.statementCapacity(input.tenantId, input.customerId),
      this.relationship(input.tenantId, input.customerId, now),
    ]);

    return assessPaymentCapacity({
      statement,
      relationship,
      declaredMonthlyIncome: input.declaredMonthlyIncome,
      currentLimit: input.currentLimit,
      policy: input.termMonths ? { termMonths: input.termMonths } : undefined,
    });
  }

  /**
   * Lo que dijo el último extracto ANALIZADO.
   *
   * Se busca el último con capacidad calculada y no simplemente el último subido: un extracto
   * rechazado o en revisión no tiene evaluación, y tomar el más reciente sin mirar eso haría que
   * subir un documento malo BORRARA la capacidad que ya se había medido con uno bueno. La evidencia
   * vieja sigue siendo evidencia hasta que otra la sustituya.
   */
  private async statementCapacity(tenantId: string, customerId: string): Promise<StatementCapacityInput> {
    const review = await this.reviews.findOne({
      where: {
        tenantId,
        customerId,
        deleted: false,
        affordabilityScore: { [Op.ne]: null },
      },
      order: [['_created_at', 'DESC']],
    } as FindOptions);

    if (!review) {
      return {
        eligible: false,
        maxAffordableInstallment: null,
        monthlyIncome: null,
        monthlyObligations: null,
        stabilityScore: null,
        affordabilityScore: null,
        band: null,
        monthsComplete: null,
      };
    }

    return {
      eligible: review.affordabilityEligible === true,
      maxAffordableInstallment: numberOrNull(review.maxAffordableInstallment),
      monthlyIncome: numberOrNull(review.observedMonthlyIncome),
      monthlyObligations: numberOrNull(review.monthlyObligations),
      stabilityScore: review.incomeStabilityScore,
      affordabilityScore: review.affordabilityScore,
      band: review.affordabilityBand,
      monthsComplete: review.monthsComplete,
    };
  }

  /** Antigüedad, historial de pago y fidelización, leídos del expediente. */
  private async relationship(tenantId: string, customerId: string, now: Date): Promise<RelationshipInput> {
    const [customer, loans, summary, identity] = await Promise.all([
      this.customers.findOne({ where: { tenantId, id: customerId } } as FindOptions),
      this.loans.findAll({ where: { tenantId, customerId } } as FindOptions),
      this.activity.findOne({ where: { tenantId, customerId } } as FindOptions),
      this.identity.findOne({ where: { tenantId, customerId }, order: [['_id', 'DESC']] } as FindOptions),
    ]);

    const tenureMonths = customer?.createdAtValue
      ? Math.max(0, Math.floor((now.getTime() - new Date(customer.createdAtValue).getTime()) / (30.44 * 86_400_000)))
      : 0;

    if (loans.length === 0) {
      return {
        tenureMonths,
        loansSettled: 0,
        loansActive: 0,
        // `null` y no 0: quien no ha pedido nunca no paga mal, simplemente no ha pagado. El dominio
        // lo distingue y parte de un valor medio en vez de del suelo.
        onTimeRatio: null,
        worstDaysPastDue: 0,
        chargeOffCount: 0,
        delinquencyCount12m: 0,
        monthsSinceLastLoan: null,
        kycComplete: identity?.finalResult === 'verified',
        fraudFlags: fraudFlagsOf(summary),
      };
    }

    const schedule = await this.installments.findAll({
      where: { tenantId, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) } },
    } as FindOptions);

    const today = now.toISOString().slice(0, 10);
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    let onTime = 0;
    let late = 0;
    let overdueInLastYear = 0;

    for (const instalment of schedule) {
      const paid = instalment.status === 'paid';
      if (paid) {
        if (Number(instalment.daysPastDue ?? 0) > 0) late += 1;
        else onTime += 1;
      } else if (instalment.dueDate < today && instalment.dueDate >= yearAgo) {
        overdueInLastYear += 1;
      }
    }

    const settledStatuses = new Set(['closed', 'paid', 'settled', 'cancelled_paid']);
    const lastDisbursement = loans
      .map((loan) => (loan.disbursedAt ? new Date(loan.disbursedAt).getTime() : 0))
      .reduce((latest, value) => Math.max(latest, value), 0);

    return {
      tenureMonths,
      loansSettled: loans.filter((loan) => settledStatuses.has(String(loan.status))).length,
      loansActive: loans.filter((loan) => String(loan.status) === 'active').length,
      onTimeRatio: onTime + late > 0 ? onTime / (onTime + late) : null,
      worstDaysPastDue: loans.reduce((worst, loan) => Math.max(worst, Number(loan.worstDaysPastDue ?? 0)), 0),
      chargeOffCount: loans.filter((loan) => String(loan.status) === 'written_off').length,
      delinquencyCount12m: overdueInLastYear,
      monthsSinceLastLoan: lastDisbursement > 0 ? Math.max(0, Math.floor((now.getTime() - lastDisbursement) / (30.44 * 86_400_000))) : null,
      kycComplete: identity?.finalResult === 'verified',
      fraudFlags: fraudFlagsOf(summary),
    };
  }
}

/**
 * Señales de fraude vivas sobre la cuenta.
 *
 * Se suman los casos de fraude de por vida y las revisiones manuales abiertas: las dos afirman lo
 * mismo para este cálculo —hay una duda sin resolver sobre quién es esta persona— y sobre esa duda
 * no se escala ningún límite.
 */
function fraudFlagsOf(summary: CustomerActivitySummaryModel | null): number {
  if (!summary) return 0;
  return Number(summary.fraudCaseCountLifetime ?? 0) + Number(summary.openManualReviewCount ?? 0);
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
