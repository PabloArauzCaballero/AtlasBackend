/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system lee la matriz vigente, sustituye la calificación anterior y agrega la cartera por categoría.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { fn, col, FindOptions, Op, Transaction } from 'sequelize';
import {
  CustomerRiskRatingModel,
  LoanModel,
  LoanRiskRatingModel,
  RatingPolicyBandModel,
  RatingPolicyVersionModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/** Estados de préstamo que la calificación mira: los que todavía representan exposición. */
export const RATEABLE_LOAN_STATUSES = ['active', 'written_off'] as const;

@Injectable()
export class CreditRatingRepository {
  constructor(
    @InjectModel(RatingPolicyVersionModel) private readonly policyModel: typeof RatingPolicyVersionModel,
    @InjectModel(RatingPolicyBandModel) private readonly bandModel: typeof RatingPolicyBandModel,
    @InjectModel(LoanRiskRatingModel) private readonly loanRatingModel: typeof LoanRiskRatingModel,
    @InjectModel(CustomerRiskRatingModel) private readonly customerRatingModel: typeof CustomerRiskRatingModel,
    @InjectModel(LoanModel) private readonly loanModel: typeof LoanModel,
  ) {}

  /**
   * La política vigente para el tenant, con la de plataforma como respaldo.
   *
   * Se piden ambas y se elige en memoria en vez de hacer dos viajes: un tenant sin política propia
   * es el caso NORMAL —la escala regulatoria es la misma para todos— y encadenar dos consultas
   * pagaría un ida y vuelta extra en el camino frecuente.
   */
  async findActivePolicy(tenantId: string, options: RepositoryOptions = {}): Promise<RatingPolicyVersionModel | null> {
    const candidates = await this.policyModel.findAll({
      where: { status: 'active', tenantId: { [Op.or]: [tenantId, null] } },
      transaction: options.transaction,
    } as FindOptions);
    return candidates.find((policy) => policy.tenantId === tenantId) ?? candidates.find((policy) => policy.tenantId === null) ?? null;
  }

  findPolicyById(policyVersionId: string, options: RepositoryOptions = {}): Promise<RatingPolicyVersionModel | null> {
    return this.policyModel.findOne({ where: { id: policyVersionId }, transaction: options.transaction } as FindOptions);
  }

  findBands(policyVersionId: string, options: RepositoryOptions = {}): Promise<RatingPolicyBandModel[]> {
    return this.bandModel.findAll({
      where: { policyVersionId },
      order: [['severityRank', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findLoanForRating(tenantId: string, loanId: string, options: RepositoryOptions = {}): Promise<LoanModel | null> {
    return this.loanModel.findOne({
      where: { id: loanId, tenantId, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  /** Los préstamos con exposición de un cliente. Es la población del arrastre. */
  findRateableLoansByCustomer(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<LoanModel[]> {
    return this.loanModel.findAll({
      where: { tenantId, customerId, deleted: false, status: { [Op.in]: [...RATEABLE_LOAN_STATUSES] } },
      order: [['id', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  /** Lote del barrido: los clientes con deuda viva, en orden estable para poder paginar. */
  async findCustomerIdsWithExposure(tenantId: string | null, limit: number): Promise<string[]> {
    const loans = await this.loanModel.findAll({
      attributes: ['customerId'],
      where: { deleted: false, status: { [Op.in]: [...RATEABLE_LOAN_STATUSES] }, ...(tenantId ? { tenantId } : {}) },
      group: ['customer_id'],
      order: [['customer_id', 'ASC']],
      limit,
      raw: true,
    } as FindOptions);
    return (loans as unknown as { customerId: string }[]).map((row) => String(row.customerId));
  }

  findCurrentLoanRating(tenantId: string, loanId: string, options: RepositoryOptions = {}): Promise<LoanRiskRatingModel | null> {
    return this.loanRatingModel.findOne({
      where: { tenantId, loanId, isCurrent: true },
      transaction: options.transaction,
    } as FindOptions);
  }

  findLoanRatingHistory(tenantId: string, loanId: string, limit: number): Promise<LoanRiskRatingModel[]> {
    return this.loanRatingModel.findAll({
      where: { tenantId, loanId },
      order: [['ratedAt', 'DESC']],
      limit,
    } as FindOptions);
  }

  findCurrentCustomerRating(
    tenantId: string,
    customerId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerRiskRatingModel | null> {
    return this.customerRatingModel.findOne({
      where: { tenantId, customerId, isCurrent: true },
      transaction: options.transaction,
    } as FindOptions);
  }

  findCustomerRatingHistory(tenantId: string, customerId: string, limit: number): Promise<CustomerRiskRatingModel[]> {
    return this.customerRatingModel.findAll({
      where: { tenantId, customerId },
      order: [['ratedAt', 'DESC']],
      limit,
    } as FindOptions);
  }

  /**
   * Sustituye la calificación vigente por una nueva.
   *
   * Baja `is_current` ANTES de insertar y dentro de la misma transacción, porque el índice único
   * parcial `(tenant, loan)` sobre las vigentes rechazaría la segunda. Ese rechazo es deliberado: es
   * lo que impide que una carrera entre el barrido nocturno y una recalificación manual deje dos
   * calificaciones vigentes del mismo crédito y ninguna forma de saber cuál rige.
   */
  async supersedeLoanRating(
    tenantId: string,
    loanId: string,
    values: Record<string, unknown>,
    transaction: Transaction,
  ): Promise<LoanRiskRatingModel> {
    await this.loanRatingModel.update({ isCurrent: false }, { where: { tenantId, loanId, isCurrent: true }, transaction });
    return this.loanRatingModel.create(values as never, { transaction });
  }

  async supersedeCustomerRating(
    tenantId: string,
    customerId: string,
    values: Record<string, unknown>,
    transaction: Transaction,
  ): Promise<CustomerRiskRatingModel> {
    await this.customerRatingModel.update({ isCurrent: false }, { where: { tenantId, customerId, isCurrent: true }, transaction });
    return this.customerRatingModel.create(values as never, { transaction });
  }

  /** Distribución de la cartera por categoría: la foto de riesgo del cierre. */
  async summarizePortfolio(tenantId: string): Promise<PortfolioGradeRow[]> {
    const rows = await this.loanRatingModel.findAll({
      attributes: [
        'grade',
        'gradeLabel',
        'severityRank',
        [fn('COUNT', col('_id')), 'loanCount'],
        [fn('SUM', col('exposure_amount')), 'exposureAmount'],
        [fn('SUM', col('provision_amount')), 'provisionAmount'],
      ],
      where: { tenantId, isCurrent: true },
      group: ['grade', 'grade_label', 'severity_rank'],
      order: [['severityRank', 'ASC']],
      raw: true,
    } as FindOptions);
    return rows as unknown as PortfolioGradeRow[];
  }
}

export type PortfolioGradeRow = {
  grade: string;
  gradeLabel: string;
  severityRank: number;
  loanCount: string;
  exposureAmount: string | null;
  provisionAmount: string | null;
};
