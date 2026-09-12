import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { LoansRepository } from '../../../src/modules/loans/loans.repository.js';

/**
 * El contrato de consulta del libro de préstamos.
 *
 * Lo que importa aquí no es que Sequelize funcione, sino tres decisiones que no se ven al leer una
 * llamada suelta: qué se bloquea (`FOR UPDATE`) antes de tocar dinero, qué estados se consideran
 * cobrables, y que ninguna consulta se olvide del `tenantId` ni de excluir lo borrado.
 */
describe('LoansRepository', () => {
  function build() {
    const model = () => ({
      findOne: jest.fn(async (..._args: unknown[]) => null),
      findAll: jest.fn(async (..._args: unknown[]) => []),
      create: jest.fn(async (..._args: unknown[]) => ({ id: 'x' })),
      bulkCreate: jest.fn(async (..._args: unknown[]) => []),
    });
    const models = {
      loan: model(),
      installment: model(),
      payment: model(),
      allocation: model(),
      event: model(),
      outcome: model(),
    };
    const repository = new LoansRepository(
      models.loan as never,
      models.installment as never,
      models.payment as never,
      models.allocation as never,
      models.event as never,
      models.outcome as never,
    );
    return { repository, models };
  }

  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  const firstArg = (mock: jest.Mock) => mock.mock.calls[0][0] as Record<string, unknown>;

  describe('lo que se bloquea antes de tocar dinero', () => {
    it('el préstamo se lee FOR UPDATE', async () => {
      const { repository, models } = build();
      await repository.findLoanForUpdate('t1', 'loan-1', transaction);
      expect(firstArg(models.loan.findOne as jest.Mock)).toMatchObject({
        where: { id: 'loan-1', tenantId: 't1', deleted: false },
        transaction,
        lock: 'UPDATE',
      });
    });

    it('las cuotas cobrables también, y sólo las que admiten cobro', async () => {
      const { repository, models } = build();
      await repository.findCollectableInstallments('t1', 'loan-1', transaction);
      const args = firstArg(models.installment.findAll as jest.Mock) as { where: Record<string, unknown>; lock: string };
      expect(args.lock).toBe('UPDATE');
      expect(args.where.status).toEqual({ [Op.in]: ['pending', 'partially_paid', 'overdue'] });
    });

    it('el cobro a reversar se lee FOR UPDATE', async () => {
      const { repository, models } = build();
      await repository.findPaymentForUpdate('t1', 'pay-1', transaction);
      expect(firstArg(models.payment.findOne as jest.Mock)).toMatchObject({ lock: 'UPDATE' });
    });
  });

  describe('aislamiento por tenant y borrado lógico', () => {
    it('las lecturas de préstamo filtran por tenant y descartan lo borrado', async () => {
      const { repository, models } = build();
      await repository.findLoanById('t1', 'loan-1');
      await repository.findLoanByApplication('t1', 'app-1');
      await repository.findLoansByCustomer('t1', 'c1');
      for (const call of (models.loan.findOne as jest.Mock).mock.calls.concat((models.loan.findAll as jest.Mock).mock.calls)) {
        expect((call[0] as { where: Record<string, unknown> }).where).toMatchObject({ tenantId: 't1', deleted: false });
      }
    });

    it('el cronograma se devuelve en orden de cuota', async () => {
      const { repository, models } = build();
      await repository.findInstallments('t1', 'loan-1');
      expect(firstArg(models.installment.findAll as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', loanId: 'loan-1', deleted: false },
        order: [['installmentNumber', 'ASC']],
      });
    });

    it('el historial de cobros y de eventos va del más reciente al más antiguo', async () => {
      const { repository, models } = build();
      await repository.findPaymentsByLoan('t1', 'loan-1');
      await repository.findEventsByLoan('t1', 'loan-1');
      expect(firstArg(models.payment.findAll as jest.Mock)).toMatchObject({ where: { tenantId: 't1', loanId: 'loan-1' } });
      expect(firstArg(models.event.findAll as jest.Mock)).toMatchObject({ where: { tenantId: 't1', loanId: 'loan-1' } });
    });
  });

  describe('escrituras', () => {
    it.each([
      ['createLoan', 'loan', 'create'],
      ['createPayment', 'payment', 'create'],
      ['createEvent', 'event', 'create'],
      ['createOutcomeReport', 'outcome', 'create'],
    ])('%s propaga la transacción del llamador', async (method, modelKey, modelMethod) => {
      const { repository, models } = build();
      const target = (models as unknown as Record<string, Record<string, jest.Mock>>)[modelKey][modelMethod];
      await (repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]({ a: 1 }, { transaction });
      expect(target.mock.calls[0][1]).toEqual({ transaction });
    });

    it.each([
      ['bulkCreateInstallments', 'installment'],
      ['bulkCreateAllocations', 'allocation'],
    ])('%s inserta el lote completo en una sola llamada', async (method, modelKey) => {
      const { repository, models } = build();
      const target = (models as unknown as Record<string, Record<string, jest.Mock>>)[modelKey].bulkCreate;
      await (repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]([{ a: 1 }, { a: 2 }], {
        transaction,
      });
      expect(target).toHaveBeenCalledTimes(1);
      expect(target.mock.calls[0][0]).toHaveLength(2);
    });
  });

  describe('idempotencia y asignaciones', () => {
    it('el cobro duplicado se busca por el hash de la clave, no por el importe', async () => {
      const { repository, models } = build();
      await repository.findPaymentByIdempotency('t1', 'hash-1', { transaction });
      expect(firstArg(models.payment.findOne as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', idempotencyKeyHash: 'hash-1' },
      });
    });

    it('las asignaciones de un cobro se leen por ese cobro', async () => {
      const { repository, models } = build();
      await repository.findAllocationsByPayment('t1', 'pay-1', { transaction });
      expect(firstArg(models.allocation.findAll as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', loanPaymentId: 'pay-1' },
      });
    });
  });

  describe('barridos de fondo', () => {
    /** El barrido atiende primero a quien lleva más tiempo sin evaluar; sin tenant, a toda la plataforma. */
    it('ordena por la evaluación más antigua y acota el lote', async () => {
      const { repository, models } = build();
      await repository.findActiveLoansForSweep('t1', 25);
      const args = firstArg(models.loan.findAll as jest.Mock) as { where: Record<string, unknown>; limit: number };
      expect(args.limit).toBe(25);
      expect(args.where).toMatchObject({ tenantId: 't1', deleted: false });
      expect(args.where.status).toEqual({ [Op.in]: ['active', 'paid_off', 'written_off'] });
    });

    it('sin tenant no filtra por tenant: el barrido es de toda la plataforma', async () => {
      const { repository, models } = build();
      await repository.findActiveLoansForSweep(null, 25);
      expect(firstArg(models.loan.findAll as jest.Mock)).not.toMatchObject({ where: { tenantId: expect.anything() } });
    });

    /** Un motor caído es un reintento, no una observación perdida. */
    it('la cola de desenlaces incluye los fallidos y sale en orden de observación', async () => {
      const { repository, models } = build();
      await repository.findPendingOutcomeReports(null, 10);
      const args = firstArg(models.outcome.findAll as jest.Mock) as { where: Record<string, unknown>; order: unknown };
      expect(args.where.status).toEqual({ [Op.in]: ['pending', 'failed'] });
      expect(args.order).toEqual([['observedAt', 'ASC']]);
    });

    it('busca el desenlace ya encolado por préstamo y ventana', async () => {
      const { repository, models } = build();
      await repository.findOutcomeReport('t1', 'loan-1', 90, { transaction });
      expect(firstArg(models.outcome.findOne as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', loanId: 'loan-1', windowDays: 90 },
      });
    });
  });
});
