/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system coordina cronograma, cobros, mora y desenlaces del préstamo dentro de transacciones explícitas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Sequelize, Transaction, literal } from 'sequelize';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { OUTCOME_WINDOW_DAYS } from './domain/loan-outcome.js';
import { customerCodesFor, loanSearchConditions } from './loan-staff-search.js';
import {
  LoanEventModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
  LoanPaymentAllocationModel,
  LoanPaymentModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

const OUTCOME_REPORTS = `${atlasSchemaFor('loan_outcome_reports')}.loan_outcome_reports`;
/** Con esta ventana encolada, un préstamo cerrado ya entregó todas sus cosechas. */
const LAST_OUTCOME_WINDOW_DAYS = Math.max(...OUTCOME_WINDOW_DAYS);

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

  /**
   * Cartera para el personal: filtros exactos, buscador (`q`) y paginación. Sin filtro, lo más
   * reciente primero. `q` es parcial y no exacto: antes el código se tenía que escribir completo.
   */
  findLoansPage(
    tenantId: string,
    filter: {
      status?: string;
      delinquencyBucket?: string;
      customerId?: string;
      creditApplicationId?: string;
      loanCode?: string;
      q?: string;
    },
    page: { limit: number; offset: number },
  ): Promise<{ rows: LoanModel[]; count: number }> {
    const { q, ...exact } = filter;
    const where: Record<string | symbol, unknown> = { tenantId, deleted: false };
    for (const [key, value] of Object.entries(exact)) if (value) where[key] = value;
    if (q) where[Op.or] = loanSearchConditions(tenantId, q, this.connection());
    return this.loanModel.findAndCountAll({
      where,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: page.limit,
      offset: page.offset,
    } as FindOptions);
  }

  /** El código de cliente de los préstamos de una página, para que la tabla enseñe lo que se busca. */
  findCustomerCodes(tenantId: string, customerIds: readonly string[]): Promise<Map<string, string | null>> {
    return customerCodesFor(this.connection(), tenantId, customerIds);
  }

  private connection(): Sequelize {
    if (!this.loanModel.sequelize) throw new Error('El modelo de préstamos no tiene conexión.');
    return this.loanModel.sequelize;
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

  /**
   * Las cuotas de VARIOS préstamos de una vez.
   *
   * El tablero de gasto y la pantalla de pagos necesitan el calendario completo del cliente para
   * decir qué vence y qué está vencido. Pedirlo préstamo a préstamo multiplica las consultas por el
   * número de compras, y es justo el cliente con más compras el que más tarda en ver su pantalla.
   */
  findInstallmentsForLoans(tenantId: string, loanIds: readonly string[]): Promise<LoanInstallmentModel[]> {
    if (loanIds.length === 0) return Promise.resolve([]);
    return this.installmentModel.findAll({
      where: { tenantId, loanId: { [Op.in]: [...new Set(loanIds)] }, deleted: false },
      order: [
        ['loanId', 'ASC'],
        ['installmentNumber', 'ASC'],
      ],
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

  /**
   * Las imputaciones de VARIOS pagos de una vez.
   *
   * La cartera del comercio necesita saber cuánto aplicó cada pago para repartirle su comisión, y
   * pedirlas pago a pago recorría la base una vez por cobro: un comercio con cien pagos hacía cien
   * consultas para pintar una tabla. Se excluyen las revertidas, igual que en la consulta unitaria:
   * un pago anulado no imputó nada y no debe devengar comisión.
   */
  findAllocationsByPayments(
    tenantId: string,
    loanPaymentIds: string[],
    options: RepositoryOptions = {},
  ): Promise<LoanPaymentAllocationModel[]> {
    if (loanPaymentIds.length === 0) return Promise.resolve([]);
    return this.allocationModel.findAll({
      where: { tenantId, loanPaymentId: { [Op.in]: loanPaymentIds }, reversed: false },
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

  /**
   * Población del barrido de mora y de cosechas: los préstamos ACTIVOS, más los cerrados que aún le
   * deben una cosecha al Motor.
   *
   * Un cerrado sin ejecución de decisión, o con su última ventana ya encolada, no tiene nada que
   * aportar: antes entraba igual, para siempre, y se repartía el lote con los activos —con miles de
   * cancelados, un activo tardaba más de un día en volver a evaluarse—.
   */
  findActiveLoansForSweep(tenantId: string | null, limit: number): Promise<LoanModel[]> {
    return this.loanModel.findAll({
      where: {
        deleted: false,
        ...(tenantId ? { tenantId } : {}),
        [Op.or]: [
          { status: 'active' },
          {
            status: { [Op.in]: ['paid_off', 'written_off'] },
            decisionExecutionId: { [Op.ne]: null },
            id: { [Op.notIn]: literal(`(SELECT r.loan_id FROM ${OUTCOME_REPORTS} r WHERE r.window_days = ${LAST_OUTCOME_WINDOW_DAYS})`) },
          },
        ],
      },
      order: [['delinquencyEvaluatedAt', 'ASC NULLS FIRST']] as unknown as FindOptions['order'],
      limit,
    } as FindOptions);
  }

  /** Sólo la marca del barrido, sin tocar nada más del préstamo: la usa el barrido cuando la evaluación falló. */
  async markDelinquencyEvaluated(tenantId: string, loanId: string, evaluatedAt: Date): Promise<void> {
    await this.loanModel.update({ delinquencyEvaluatedAt: evaluatedAt }, { where: { id: loanId, tenantId } });
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
