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
  FraudCaseModel,
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
import {
  IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
  isIdentityVerified,
  pickCurrentIdentityAttempt,
} from '../../../common/utils/identity/identity-result.util.js';

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
    @InjectModel(FraudCaseModel) private readonly fraudCases: typeof FraudCaseModel,
  ) {}

  async assess(input: {
    tenantId: string;
    customerId: string;
    declaredMonthlyIncome: number | null;
    currentLimit: number | null;
    termMonths?: number;
    now?: Date;
  }): Promise<PaymentCapacityAssessment> {
    return (await this.assessDetailed(input)).assessment;
  }

  /**
   * Lo mismo que `assess`, devolviendo además la entrada de relación con la que se calculó.
   *
   * La pantalla de nivel necesita las dos cosas —el puntaje y las conductas que lo componen— y pedirlas por
   * separado habría repetido las consultas de préstamos, actividad e identidad. No llama al motor: es sólo la
   * base de datos, así que un cliente SIN línea de crédito calculada también tiene nivel.
   */
  async assessDetailed(input: {
    tenantId: string;
    customerId: string;
    declaredMonthlyIncome: number | null;
    currentLimit: number | null;
    termMonths?: number;
    now?: Date;
  }): Promise<{ assessment: PaymentCapacityAssessment; relationship: RelationshipInput }> {
    const now = input.now ?? new Date();
    const [statement, relationship] = await Promise.all([
      this.statementCapacity(input.tenantId, input.customerId, now),
      this.relationship(input.tenantId, input.customerId, now),
    ]);

    const assessment = assessPaymentCapacity({
      statement,
      relationship,
      declaredMonthlyIncome: input.declaredMonthlyIncome,
      currentLimit: input.currentLimit,
      policy: input.termMonths ? { termMonths: input.termMonths } : undefined,
    });
    return { assessment, relationship };
  }

  /**
   * Lo que dijo el último extracto ANALIZADO.
   *
   * Se busca el último con capacidad calculada y no simplemente el último subido: un extracto
   * rechazado o en revisión no tiene evaluación, y tomar el más reciente sin mirar eso haría que
   * subir un documento malo BORRARA la capacidad que ya se había medido con uno bueno. La evidencia
   * vieja sigue siendo evidencia hasta que otra la sustituya.
   */
  private async statementCapacity(tenantId: string, customerId: string, now: Date): Promise<StatementCapacityInput> {
    const found = await this.reviews.findOne({
      where: {
        tenantId,
        customerId,
        deleted: false,
        affordabilityScore: { [Op.ne]: null },
      },
      order: [['_created_at', 'DESC']],
    } as FindOptions);
    // Un extracto cuyo último movimiento es anterior al tope ya no demuestra cuánto puede pagar hoy: se trata como
    // si no existiera y la propuesta cae a lo declarado, que es conservador y queda marcado como tal.
    const review = found && !isStatementTooOld(found.periodTo, now) ? found : null;

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

  /**
   * Casos de fraude que SIGUEN pesando: los abiertos y los que se cerraron confirmando el fraude, bloqueando o
   * escalando. Un caso cerrado como `false_positive` ya no dice nada de esta persona; con el contador «de por vida»
   * de antes, un falso positivo la dejaba en el suelo para siempre. «Necesita más investigación» deja el caso en
   * `in_progress` CON `closed_at` puesto (`fraud.service.ts`), por eso se mira `case_status` y no `closed_at`.
   */
  private liveFraudCaseCount(tenantId: string, customerId: string): Promise<number> {
    return this.fraudCases.count({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
        [Op.or]: [{ caseStatus: null }, { caseStatus: { [Op.ne]: 'closed' } }, { resolution: { [Op.in]: FRAUD_RESOLUTIONS_THAT_STICK } }],
      },
    } as FindOptions);
  }

  /** Antigüedad, historial de pago y fidelización, leídos del expediente. */
  private async relationship(tenantId: string, customerId: string, now: Date): Promise<RelationshipInput> {
    const [customer, loans, summary, identityAttempts, liveFraudCases] = await Promise.all([
      this.customers.findOne({ where: { tenantId, id: customerId } } as FindOptions),
      // Las filas borradas no son historial: un préstamo o una cuota dados de baja no pueden contar como pagados ni como mora.
      this.loans.findAll({ where: { tenantId, customerId, deleted: false } } as FindOptions),
      this.activity.findOne({ where: { tenantId, customerId } } as FindOptions),
      // Todos los recientes, no sólo el último: un intento posterior sin resolver no puede tapar un
      // `verified` anterior (I-2). Ver `pickCurrentIdentityAttempt`.
      this.identity.findAll({
        where: { tenantId, customerId },
        order: [['_id', 'DESC']],
        limit: IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
      } as FindOptions),
      this.liveFraudCaseCount(tenantId, customerId),
    ]);
    const identity = pickCurrentIdentityAttempt(identityAttempts);

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
        kycComplete: isIdentityVerified(identity?.finalResult),
        fraudFlags: fraudFlagsOf(summary, liveFraudCases),
      };
    }

    const schedule = await this.installments.findAll({
      where: { tenantId, deleted: false, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) } },
    } as FindOptions);

    const today = businessDate(now);
    const yearAgo = businessDate(new Date(now.getTime() - 365 * 86_400_000));
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

    // `paid_off` es el estado real de un crédito devuelto (`ck_loans_status`): buscar otros nombres dejaba
    // `loansSettled` siempre en 0 y la fidelización sin su mayor componente.
    const settledStatuses = new Set(['paid_off']);
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
      kycComplete: isIdentityVerified(identity?.finalResult),
      fraudFlags: fraudFlagsOf(summary, liveFraudCases),
    };
  }
}

/**
 * Señales de fraude vivas sobre la cuenta.
 *
 * Se suman los casos de fraude VIVOS (abiertos o cerrados confirmando el fraude) y las revisiones manuales abiertas: las dos afirman lo
 * mismo para este cálculo —hay una duda sin resolver sobre quién es esta persona— y sobre esa duda
 * no se escala ningún límite.
 */
function fraudFlagsOf(summary: CustomerActivitySummaryModel | null, liveFraudCases: number): number {
  return Number(liveFraudCases) + Number(summary?.openManualReviewCount ?? 0);
}

/** Las resoluciones de un caso cerrado que siguen contando contra la persona (D-3 del plan 2026-10-05). */
export const FRAUD_RESOLUTIONS_THAT_STICK = ['confirmed_fraud', 'blocked', 'escalated'];

/** Hasta qué antigüedad un extracto vale como evidencia de capacidad (D-2 del plan 2026-10-05). */
export const STATEMENT_MAX_AGE_DAYS = 180;

/** Bolivia es UTC−4 y no tiene horario de verano: «hoy» para una cuota es la fecha de La Paz, no la de UTC. */
const LA_PAZ_OFFSET_MS = 4 * 3_600_000;

export function businessDate(instant: Date): string {
  return new Date(instant.getTime() - LA_PAZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Sin fecha de período no se puede probar que sea reciente, así que no se descarta: lo decide quien la lea. */
export function isStatementTooOld(periodTo: string | Date | null | undefined, now: Date): boolean {
  if (!periodTo) return false;
  const end = new Date(periodTo).getTime();
  if (!Number.isFinite(end)) return false;
  return now.getTime() - end > STATEMENT_MAX_AGE_DAYS * 86_400_000;
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
