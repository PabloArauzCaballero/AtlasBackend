import { describe, expect, it, jest } from '@jest/globals';
import { OperationsRepository } from '../../../src/modules/operations/operations.repository.js';
import { encodeCursor } from '../../../src/common/utils/pagination/cursor-pagination.util.js';

/**
 * Cobertura directa de `OperationsRepository` (Fase 1.2 del plan 10/10): finders de la cola de
 * revisión manual/fraude y las escrituras de auditoría del cierre de un caso. El servicio lo mockea,
 * así que su capa de persistencia no se ejercitaba. Modelos Sequelize mockeados.
 */
describe('OperationsRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn() });
    const models = {
      manualReviewCase: make(),
      fraudCase: make(),
      manualReviewEvent: make(),
      customerStatusEvent: make(),
      operationalAudit: make(),
      dataChangeLog: make(),
      customerObservation: make(),
    };
    const repo = new OperationsRepository(
      models.manualReviewCase as never,
      models.fraudCase as never,
      models.manualReviewEvent as never,
      models.customerStatusEvent as never,
      models.operationalAudit as never,
      models.dataChangeLog as never,
      models.customerObservation as never,
    );
    return { repo, models };
  }

  const tx = { transaction: 'tx' as never };

  describe('finders de expediente del cliente', () => {
    it('findOpenManualReviewCasesForCustomer trae solo casos ABIERTOS (closedAt null) no borrados, top 10', async () => {
      const { repo, models } = buildRepo();
      (models.manualReviewCase.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.findOpenManualReviewCasesForCustomer('t1', 'c1');
      const options = (models.manualReviewCase.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
      expect(options.where).toMatchObject({ tenantId: 't1', customerId: 'c1', closedAt: null });
      expect(options.where.deleted).toBeDefined();
      expect(options.limit).toBe(10);
    });

    it('findFraudCasesForCustomer filtra por tenant+cliente no borrado, top 10', async () => {
      const { repo, models } = buildRepo();
      (models.fraudCase.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.findFraudCasesForCustomer('t1', 'c1');
      const options = (models.fraudCase.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
      expect(options.where).toMatchObject({ tenantId: 't1', customerId: 'c1' });
      expect(options.limit).toBe(10);
    });

    it('findManualReviewCaseById filtra por tenant, id y no-borrado', async () => {
      const { repo, models } = buildRepo();
      (models.manualReviewCase.findOne as jest.Mock).mockResolvedValue({ id: 'mr1' } as never);
      const result = await repo.findManualReviewCaseById('t1', 'mr1');
      expect(result).toEqual({ id: 'mr1' });
      expect((models.manualReviewCase.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', id: 'mr1' },
      });
    });
  });

  it('closeManualReviewCase pone el caso en closed y lo guarda en la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ saved: true }));
    const caseModel = { save } as never;
    await repo.closeManualReviewCase(caseModel, { resolution: 'approved', notes: 'ok', closedAt: new Date('2026-01-01') }, tx);
    expect((caseModel as { status: string }).status).toBe('closed');
    expect((caseModel as { resolution: string }).resolution).toBe('approved');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  describe('escrituras de auditoría del cierre', () => {
    it('createManualReviewEvent mapea caseId -> manualReviewCaseId', async () => {
      const { repo, models } = buildRepo();
      await repo.createManualReviewEvent(
        {
          tenantId: 't1',
          caseId: 'mr1',
          eventType: 'decision_recorded',
          actorType: 'compliance_analyst',
          actorInternalUserId: 'u1',
          payload: { decision: 'approved' },
          notes: null,
          happenedAt: new Date('2026-01-01'),
        },
        tx,
      );
      const [values, opts] = (models.manualReviewEvent.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ manualReviewCaseId: 'mr1', eventType: 'decision_recorded' });
      expect(opts).toEqual({ transaction: 'tx' });
    });

    it('createStatusEvent / createCustomerObservation / createOperationalAudit / createDataChange delegan a su modelo dentro de la transacción', async () => {
      const { repo, models } = buildRepo();
      const base = { tenantId: 't1', happenedAt: new Date('2026-01-01') };
      await repo.createStatusEvent(
        { ...base, customerId: 'c1', previousStatus: null, newStatus: 'under_review', reasonCode: 'r', actorType: 'a', actorInternalUserId: 'u1', notes: null },
        tx,
      );
      await repo.createCustomerObservation({ ...base, customerId: 'c1', observationCode: 'oc', payload: {} }, tx);
      await repo.createOperationalAudit(
        { ...base, actorType: 'a', actorInternalUserId: 'u1', actionCode: 'ac', targetType: 'tt', targetId: 'ti', payload: {} },
        tx,
      );
      await repo.createDataChange(
        { ...base, tableName: 'manual_review_cases', recordId: 'mr1', changeType: 'decision', actorType: 'a', actorInternalUserId: 'u1', reason: 'r' },
        tx,
      );

      expect(models.customerStatusEvent.create).toHaveBeenCalledTimes(1);
      expect(models.customerObservation.create).toHaveBeenCalledTimes(1);
      expect(models.operationalAudit.create).toHaveBeenCalledTimes(1);
      expect(models.dataChangeLog.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('colas de trabajo (offset + cursor)', () => {
    it('findManualReviewCasesForQueue aplica filtros y el orden dinámico por sortBy', async () => {
      const { repo, models } = buildRepo();
      (models.manualReviewCase.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [{ id: 'mr1' }], count: 3 } as never);
      const res = await repo.findManualReviewCasesForQueue('t1', { status: 'open', priority: 'high', customerId: 'c1', sortBy: 'updatedAt', sortOrder: 'asc', page: 2, limit: 10 } as never);
      const opts = (models.manualReviewCase.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: string[][] };
      expect(opts.where).toMatchObject({ tenantId: 't1', status: 'open', priority: 'high', customerId: 'c1' });
      expect(opts.order[0]).toEqual(['updatedAtValue', 'ASC']);
      expect(res.meta).toMatchObject({ total: 3 });
    });

    it('findFraudCasesForQueue mapea status->caseStatus y priority->severity', async () => {
      const { repo, models } = buildRepo();
      (models.fraudCase.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
      await repo.findFraudCasesForQueue('t1', { status: 'open', priority: 'high', sortBy: 'createdAt', sortOrder: 'desc', page: 1, limit: 10 } as never);
      expect((models.fraudCase.findAndCountAll as jest.Mock).mock.calls[0][0].where).toMatchObject({ caseStatus: 'open', severity: 'high' });
    });

    it('findManualReviewCasesForQueueWithCursor: nextCursor null sin más filas; corta y arma cursor cuando hasMore', async () => {
      const noMore = buildRepo();
      (noMore.models.manualReviewCase.findAll as jest.Mock).mockResolvedValue([{ id: 'a', createdAtValue: new Date('2026-01-01T00:00:00.000Z') }] as never);
      const r1 = await noMore.repo.findManualReviewCasesForQueueWithCursor('t1', { sortBy: 'createdAt', limit: 2 });
      expect(r1.items).toHaveLength(1);
      expect(r1.nextCursor).toBeNull();

      const more = buildRepo();
      (more.models.manualReviewCase.findAll as jest.Mock).mockResolvedValue([
        { id: 'a', createdAtValue: new Date('2026-01-02T00:00:00.000Z') },
        { id: 'b', createdAtValue: new Date('2026-01-01T00:00:00.000Z') },
      ] as never);
      const r2 = await more.repo.findManualReviewCasesForQueueWithCursor('t1', { status: 'open', sortBy: 'createdAt', limit: 1 });
      expect(r2.items).toHaveLength(1);
      expect(r2.nextCursor).toEqual(expect.any(String));
    });

    it('un cursor válido activa la rama keyset (decodeCursor) en el where', async () => {
      const { repo, models } = buildRepo();
      (models.fraudCase.findAll as jest.Mock).mockResolvedValue([] as never);
      const cursor = encodeCursor({ createdAt: '2026-01-01T00:00:00.000Z', id: 'x' });
      await repo.findFraudCasesForQueueWithCursor('t1', { sortBy: 'updatedAt', limit: 5, cursor });
      const where = (models.fraudCase.findAll as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
      expect(Object.getOwnPropertySymbols(where).length).toBeGreaterThan(0); // Op.and del keyset
    });
  });

  describe('filtros opcionales de las colas (con todos y sin ninguno)', () => {
    const allFilters = { status: 'open', priority: 'high', customerId: 'c1', sortBy: 'updatedAt', sortOrder: 'asc', page: 1, limit: 20 };
    const noFilters = { sortBy: 'createdAt', sortOrder: 'desc', page: 1, limit: 20 };

    it('revisión manual: con todos los filtros ordena por updatedAtValue ASC; sin filtros solo acota tenant + no-borrado', async () => {
      const { repo, models } = buildRepo();
      (models.manualReviewCase.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);

      await repo.findManualReviewCasesForQueue('t1', allFilters as never);
      const full = (models.manualReviewCase.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: string[][] };
      expect(full.where).toMatchObject({ tenantId: 't1', status: 'open', priority: 'high', customerId: 'c1' });
      expect(full.order[0]).toEqual(['updatedAtValue', 'ASC']);

      await repo.findManualReviewCasesForQueue('t1', noFilters as never);
      const bare = (models.manualReviewCase.findAndCountAll as jest.Mock).mock.calls[1][0] as { where: Record<string, unknown>; order: string[][] };
      expect(bare.where.status).toBeUndefined();
      expect(bare.where.priority).toBeUndefined();
      expect(bare.where.customerId).toBeUndefined();
      expect(bare.order[0]).toEqual(['createdAtValue', 'DESC']);
    });

    it('fraude: mapea status->caseStatus y priority->severity, y sin filtros no los agrega', async () => {
      const { repo, models } = buildRepo();
      (models.fraudCase.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);

      await repo.findFraudCasesForQueue('t1', allFilters as never);
      const full = (models.fraudCase.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: string[][] };
      expect(full.where).toMatchObject({ tenantId: 't1', caseStatus: 'open', severity: 'high', customerId: 'c1' });
      expect(full.order[0]).toEqual(['updatedAtValue', 'ASC']);

      await repo.findFraudCasesForQueue('t1', noFilters as never);
      const bare = (models.fraudCase.findAndCountAll as jest.Mock).mock.calls[1][0] as { where: Record<string, unknown> };
      expect(bare.where.caseStatus).toBeUndefined();
      expect(bare.where.severity).toBeUndefined();
    });

    it('cola de fraude por cursor: con más filas de las pedidas recorta y emite nextCursor; si no, null', async () => {
      const { repo, models } = buildRepo();
      const rows = [
        { id: '3', createdAtValue: new Date('2026-01-03T00:00:00.000Z') },
        { id: '2', createdAtValue: new Date('2026-01-02T00:00:00.000Z') },
        { id: '1', createdAtValue: new Date('2026-01-01T00:00:00.000Z') },
      ];
      (models.fraudCase.findAll as jest.Mock).mockResolvedValueOnce(rows as never);
      const page = await repo.findFraudCasesForQueueWithCursor('t1', { status: 'open', priority: 'high', customerId: 'c1', sortBy: 'createdAt', limit: 2 } as never);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
      const where = (models.fraudCase.findAll as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
      expect(where).toMatchObject({ caseStatus: 'open', severity: 'high', customerId: 'c1' });

      (models.fraudCase.findAll as jest.Mock).mockResolvedValueOnce([rows[0]] as never);
      const last = await repo.findFraudCasesForQueueWithCursor('t1', { sortBy: 'updatedAt', limit: 5 } as never);
      expect(last.nextCursor).toBeNull();
    });
  });
});
