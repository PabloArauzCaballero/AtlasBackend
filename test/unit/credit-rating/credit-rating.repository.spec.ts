import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CreditRatingRepository, RATEABLE_LOAN_STATUSES } from '../../../src/modules/credit-rating/credit-rating.repository.js';

/**
 * Lecturas y sustituciones de la calificación de riesgo.
 *
 * Dos decisiones que este archivo tiene que sostener y que no se ven al leer una llamada suelta: la
 * política del tenant gana sobre la de plataforma (y la de plataforma existe justamente para que un
 * tenant sin política propia siga calificando), y una calificación nueva BAJA la vigente antes de
 * insertarse — si no, el índice único parcial rechaza la segunda y el barrido nocturno choca contra
 * una recalificación manual.
 */
describe('CreditRatingRepository', () => {
  function build() {
    const model = () => ({
      findOne: jest.fn(async (..._args: unknown[]) => null),
      findAll: jest.fn(async (..._args: unknown[]) => []),
      create: jest.fn(async (..._args: unknown[]) => ({ id: 'nueva' })),
      update: jest.fn(async (..._args: unknown[]) => [1]),
    });
    const models = { policy: model(), band: model(), loanRating: model(), customerRating: model(), loan: model() };
    const repository = new CreditRatingRepository(
      models.policy as never,
      models.band as never,
      models.loanRating as never,
      models.customerRating as never,
      models.loan as never,
    );
    return { repository, models };
  }

  const transaction = {} as never;
  const firstArg = (mock: jest.Mock) => mock.mock.calls[0][0] as Record<string, unknown>;

  describe('política vigente', () => {
    it('pide las dos candidatas de una vez y prefiere la del tenant', async () => {
      const { repository, models } = build();
      (models.policy.findAll as jest.Mock).mockResolvedValueOnce([
        { id: 'plataforma', tenantId: null },
        { id: 'propia', tenantId: 't1' },
      ] as never);

      await expect(repository.findActivePolicy('t1')).resolves.toMatchObject({ id: 'propia' });
      expect(models.policy.findAll).toHaveBeenCalledTimes(1);
      expect(firstArg(models.policy.findAll as jest.Mock)).toMatchObject({ where: { status: 'active' } });
    });

    /** Un tenant sin política propia es el caso NORMAL: la escala regulatoria es la misma para todos. */
    it('cae a la de plataforma cuando el tenant no tiene la suya', async () => {
      const { repository, models } = build();
      (models.policy.findAll as jest.Mock).mockResolvedValueOnce([{ id: 'plataforma', tenantId: null }] as never);
      await expect(repository.findActivePolicy('t1')).resolves.toMatchObject({ id: 'plataforma' });
    });

    it('devuelve null cuando no hay ninguna activa', async () => {
      const { repository } = build();
      await expect(repository.findActivePolicy('t1')).resolves.toBeNull();
    });

    it('las bandas salen de menor a mayor severidad: el orden ES la escala', async () => {
      const { repository, models } = build();
      await repository.findBands('pol-1');
      expect(firstArg(models.band.findAll as jest.Mock)).toMatchObject({
        where: { policyVersionId: 'pol-1' },
        order: [['severityRank', 'ASC']],
      });
    });

    it('busca una política concreta por su id', async () => {
      const { repository, models } = build();
      await repository.findPolicyById('pol-1', { transaction });
      expect(firstArg(models.policy.findOne as jest.Mock)).toMatchObject({ where: { id: 'pol-1' }, transaction });
    });
  });

  describe('población calificable', () => {
    it('sólo entran los préstamos con exposición viva', async () => {
      const { repository, models } = build();
      await repository.findRateableLoansByCustomer('t1', 'c1');
      const where = (firstArg(models.loan.findAll as jest.Mock) as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ tenantId: 't1', customerId: 'c1', deleted: false });
      expect(where.status).toEqual({ [Op.in]: [...RATEABLE_LOAN_STATUSES] });
    });

    it('el lote del barrido agrupa por cliente y sale en orden estable para poder paginar', async () => {
      const { repository, models } = build();
      (models.loan.findAll as jest.Mock).mockResolvedValueOnce([{ customerId: 7 }, { customerId: 9 }] as never);

      await expect(repository.findCustomerIdsWithExposure('t1', 50)).resolves.toEqual(['7', '9']);

      expect(firstArg(models.loan.findAll as jest.Mock)).toMatchObject({
        group: ['customer_id'],
        order: [['customer_id', 'ASC']],
        limit: 50,
      });
    });

    it('sin tenant, el barrido recorre toda la plataforma', async () => {
      const { repository, models } = build();
      await repository.findCustomerIdsWithExposure(null, 50);
      expect((firstArg(models.loan.findAll as jest.Mock) as { where: Record<string, unknown> }).where).not.toHaveProperty('tenantId');
    });

    it('lee el préstamo a calificar dentro de su tenant y sin borrados', async () => {
      const { repository, models } = build();
      await repository.findLoanForRating('t1', 'loan-1', { transaction });
      expect(firstArg(models.loan.findOne as jest.Mock)).toMatchObject({
        where: { id: 'loan-1', tenantId: 't1', deleted: false },
      });
    });
  });

  describe('vigente e historial', () => {
    it.each([
      ['findCurrentLoanRating', 'loanRating', { loanId: 'loan-1' }],
      ['findCurrentCustomerRating', 'customerRating', { customerId: 'c1' }],
    ])('%s exige isCurrent', async (method, modelKey, extra) => {
      const { repository, models } = build();
      const target = (models as unknown as Record<string, Record<string, jest.Mock>>)[modelKey].findOne;
      const id = Object.values(extra)[0] as string;
      await (repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]('t1', id, { transaction });
      expect((target.mock.calls[0][0] as { where: Record<string, unknown> }).where).toMatchObject({
        tenantId: 't1',
        isCurrent: true,
        ...extra,
      });
    });

    it.each([
      ['findLoanRatingHistory', 'loanRating'],
      ['findCustomerRatingHistory', 'customerRating'],
    ])('%s devuelve lo más reciente primero y acota el tamaño', async (method, modelKey) => {
      const { repository, models } = build();
      const target = (models as unknown as Record<string, Record<string, jest.Mock>>)[modelKey].findAll;
      await (repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]('t1', 'x', 5);
      expect(target.mock.calls[0][0]).toMatchObject({ order: [['ratedAt', 'DESC']], limit: 5 });
    });
  });

  describe('sustitución', () => {
    it.each([
      ['supersedeLoanRating', 'loanRating', 'loanId'],
      ['supersedeCustomerRating', 'customerRating', 'customerId'],
    ])('%s baja la vigente ANTES de insertar, en la misma transacción', async (method, modelKey, idField) => {
      const { repository, models } = build();
      const target = (models as unknown as Record<string, Record<string, jest.Mock>>)[modelKey];
      const order: string[] = [];
      target.update.mockImplementation(async () => {
        order.push('update');
        return [1];
      });
      target.create.mockImplementation(async () => {
        order.push('create');
        return { id: 'nueva' };
      });

      await (repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method](
        't1',
        'x',
        { grade: 'B' },
        transaction,
      );

      expect(order).toEqual(['update', 'create']);
      expect(target.update.mock.calls[0][0]).toEqual({ isCurrent: false });
      expect(target.update.mock.calls[0][1]).toMatchObject({
        where: { tenantId: 't1', [idField]: 'x', isCurrent: true },
        transaction,
      });
      expect(target.create.mock.calls[0][1]).toEqual({ transaction });
    });
  });

  it('la foto de cartera agrupa por categoría y sale por severidad', async () => {
    const { repository, models } = build();
    await repository.summarizePortfolio('t1');
    expect(firstArg(models.loanRating.findAll as jest.Mock)).toMatchObject({
      where: { tenantId: 't1', isCurrent: true },
      group: ['grade', 'grade_label', 'severity_rank'],
      order: [['severityRank', 'ASC']],
      raw: true,
    });
  });
});
