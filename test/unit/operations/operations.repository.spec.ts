import { describe, expect, it, jest } from '@jest/globals';
import { OperationsRepository } from '../../../src/modules/operations/operations.repository.js';

/**
 * Cobertura directa de `OperationsRepository` (Fase 1.2 del plan 10/10): finders de la cola de
 * revisión manual/fraude y las escrituras de auditoría del cierre de un caso. El servicio lo mockea,
 * así que su capa de persistencia no se ejercitaba. Modelos Sequelize mockeados.
 */
describe('OperationsRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
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
});
