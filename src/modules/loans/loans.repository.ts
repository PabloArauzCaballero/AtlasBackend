/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system coordina cronograma, cobros, mora y desenlaces del préstamo dentro de transacciones explícitas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/** Cuotas que todavía pueden recibir un cobro. Una castigada ya no: su saldo salió del libro. */
const COLLECTABLE_STATUSES = ['pending', 'partially_paid', 'overdue'];

@Injectable()
export class LoansRepository {
  constructor(
    @InjectModel(LoanModel) private readonly loanModel: typeof LoanModel,
    @InjectModel(LoanInstallmentModel) private readonly installmentModel: typeof LoanInstallmentModel,
    @InjectModel(LoanPaymentModel) private readonly paymentModel: typeof LoanPaymentModel,
    @InjectModel(LoanPaymentAllocationModel) private readonly allocationModel: typeof LoanPaymentAllocationModel,
    @InjectModel(LoanEventModel) private readonly eventModel: typeof LoanEventModel,
    @InjectModel(LoanOutcomeReportModel) private readonly outcomeModel: typeof LoanOutcomeReportModel,
  ) {}

  /**
   * Bloquea el préstamo mientras se le aplica un cobro.
   *
   * `FOR UPDATE` y no una lectura simple: dos cobros concurrentes leerían el mismo saldo, cada uno
   * calcularía su reparto sobre él y el segundo pisaría al primero. El dinero entra dos veces y el
   * saldo baja una.
   */
  findLoanForUpdate(tenantId: string, loanId: string, transaction: Transaction): Promise<LoanModel | null> {
    return this.loanModel.findOne({
      where: { id: loanId, tenantId, deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    } as FindOptions);
  }

  findLoanById(tenantId: string, loanId: string, options: RepositoryOptions = {}): Promise<LoanModel | null> {
    return this.loanModel.findOne({
      where: { id: loanId, tenantId, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  findLoanByApplication(tenantId: string, creditApplicationId: string, options: RepositoryOptions = {}): Promise<LoanModel | null> {
    return this.loanModel.findOne({
      where: { tenantId, creditApplicationId, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  findLoansByCustomer(tenantId: string, customerId: string): Promise<LoanModel[]> {
    return this.loanModel.findAll({
      where: { tenantId, customerId, deleted: false },
      order: [['createdAtValue', 'DESC']],
    } as FindOptions);
  }

  createLoan(values: Record<string, unknown>, options: RepositoryOptions = {}): Promise<LoanModel> {
    return this.loanModel.create(values as never, { transaction: options.transaction });
  }

  bulkCreateInstallments(rows: Record<string, unknown>[], options: RepositoryOptions = {}): Promise<LoanInstallmentModel[]> {
    return this.installmentModel.bulkCreate(rows as never[], { transaction: options.transaction });
  }

  findInstallments(tenantId: string, loanId: string, options: RepositoryOptions = {}): Promise<LoanInstallmentModel[]> {
    return this.installmentModel.findAll({
      where: { tenantId, loanId, deleted: false },
      order: [['installmentNumber', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findCollectableInstallments(tenantId: string, loanId: string, transaction: Transaction): Promise<LoanInstallmentModel[]> {
    return this.installmentModel.findAll({
      where: { tenantId, loanId, deleted: false, status: { [Op.in]: COLLECTABLE_STATUSES } },
      order: [['installmentNumber', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    } as FindOptions);
  }

  createPayment(values: Record<string, unknown>, options: RepositoryOptions = {}): Promise<LoanPaymentModel> {
    return this.paymentModel.create(values as never, { transaction: options.transaction });
  }

  findPaymentByIdempotency(
    tenantId: string,
    idempotencyKeyHash: string,
    options: RepositoryOptions = {},
  ): Promise<LoanPaymentModel | null> {
    return this.paymentModel.findOne({
      where: { tenantId, idempotencyKeyHash, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  findPaymentForUpdate(tenantId: string, paymentId: string, transaction: Transaction): Promise<LoanPaymentModel | null> {
    return this.paymentModel.findOne({
      where: { id: paymentId, tenantId, deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    } as FindOptions);
  }

  findPaymentsByLoan(tenantId: string, loanId: string): Promise<LoanPaymentModel[]> {
    return this.paymentModel.findAll({
      where: { tenantId, loanId, deleted: false },
      order: [['receivedAt', 'DESC']],
    } as FindOptions);
  }

  bulkCreateAllocations(rows: Record<string, unknown>[], options: RepositoryOptions = {}): Promise<LoanPaymentAllocationModel[]> {
    return this.allocationModel.bulkCreate(rows as never[], { transaction: options.transaction });
  }

  findAllocationsByPayment(
    tenantId: string,
    loanPaymentId: string,
    options: RepositoryOptions = {},
  ): Promise<LoanPaymentAllocationModel[]> {
    return this.allocationModel.findAll({
      where: { tenantId, loanPaymentId, reversed: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  createEvent(values: Record<string, unknown>, options: RepositoryOptions = {}): Promise<LoanEventModel> {
    return this.eventModel.create(values as never, { transaction: options.transaction });
  }

  findEventsByLoan(tenantId: string, loanId: string): Promise<LoanEventModel[]> {
    return this.eventModel.findAll({
      where: { tenantId, loanId },
      order: [['happenedAt', 'DESC']],
    } as FindOptions);
  }

  /** Préstamos vivos con decisión asociada: la población de la que salen las cosechas. */
  findActiveLoansForSweep(tenantId: string | null, limit: number): Promise<LoanModel[]> {
    return this.loanModel.findAll({
      where: {
        deleted: false,
        status: { [Op.in]: ['active', 'paid_off', 'written_off'] },
        ...(tenantId ? { tenantId } : {}),
      },
      order: [['delinquencyEvaluatedAt', 'ASC NULLS FIRST']] as unknown as FindOptions['order'],
      limit,
    } as FindOptions);
  }

  findOutcomeReport(
    tenantId: string,
    loanId: string,
    windowDays: number,
    options: RepositoryOptions = {},
  ): Promise<LoanOutcomeReportModel | null> {
    return this.outcomeModel.findOne({
      where: { tenantId, loanId, windowDays },
      transaction: options.transaction,
    } as FindOptions);
  }

  createOutcomeReport(values: Record<string, unknown>, options: RepositoryOptions = {}): Promise<LoanOutcomeReportModel> {
    return this.outcomeModel.create(values as never, { transaction: options.transaction });
  }

  /** Lo que queda por entregar al motor. `failed` vuelve a la cola: un motor caído es un reintento. */
  findPendingOutcomeReports(tenantId: string | null, limit: number): Promise<LoanOutcomeReportModel[]> {
    return this.outcomeModel.findAll({
      where: { status: { [Op.in]: ['pending', 'failed'] }, ...(tenantId ? { tenantId } : {}) },
      order: [['observedAt', 'ASC']],
      limit,
    } as FindOptions);
  }
}
