import { describe, expect, it, jest } from '@jest/globals';
import { FraudRepository } from '../../../src/modules/fraud/fraud.repository.js';

/**
 * Cobertura directa de `FraudRepository` (Fase 1.2 del plan 10/10). Verifica el mapeo de cada
 * escritura de decisión de fraude al modelo correcto y la propagación de la transacción — la capa
 * que garantiza que la auditoría de una decisión de fraude (watchlist, status event, data-change)
 * quede persistida de forma consistente. Los modelos Sequelize se mockean.
 */
describe('FraudRepository', () => {
  function buildRepo() {
    const models = {
      fraudCaseModel: { findOne: jest.fn() },
      fraudCaseEventModel: { create: jest.fn() },
      watchlistEntryModel: { create: jest.fn() },
      customerStatusEventModel: { create: jest.fn() },
      customerObservationModel: { create: jest.fn() },
      operationalAuditLogModel: { create: jest.fn() },
      dataChangeLogModel: { create: jest.fn() },
    };
    const repo = new FraudRepository(
      models.fraudCaseModel as never,
      models.fraudCaseEventModel as never,
      models.watchlistEntryModel as never,
      models.customerStatusEventModel as never,
      models.customerObservationModel as never,
      models.operationalAuditLogModel as never,
      models.dataChangeLogModel as never,
    );
    return { repo, models };
  }

  const tx = { LOCK: 'x' } as never;

  it('findFraudCaseById filtra por tenant, id y no-borrado', async () => {
    const { repo, models } = buildRepo();
    (models.fraudCaseModel.findOne as jest.Mock).mockResolvedValue({ id: 'c1' } as never);

    const result = await repo.findFraudCaseById('t1', 'c1');

    expect(result).toEqual({ id: 'c1' });
    const where = (models.fraudCaseModel.findOne as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 't1', id: 'c1' });
    expect(where.deleted).toBeDefined(); // { [Op.ne]: true }
  });

  it('closeFraudCase muta el caso y lo guarda dentro de la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ saved: true }));
    const caseModel = { save } as never;

    await repo.closeFraudCase(
      caseModel,
      { resolution: 'confirmed_fraud', notes: 'n', closedAt: new Date('2026-01-01'), nextStatus: 'closed' },
      { transaction: tx },
    );

    expect((caseModel as { caseStatus: string }).caseStatus).toBe('closed');
    expect((caseModel as { resolution: string }).resolution).toBe('confirmed_fraud');
    expect(save).toHaveBeenCalledWith({ transaction: tx });
  });

  it('createFraudCaseEvent mapea caseId->fraudCaseId y payload->payloadJson', async () => {
    const { repo, models } = buildRepo();
    await repo.createFraudCaseEvent(
      {
        tenantId: 't1',
        caseId: 'c1',
        eventType: 'fraud_decision_recorded',
        actorType: 'fraud_analyst',
        actorInternalUserId: 'u1',
        payload: { decision: 'blocked' },
        notes: null,
        happenedAt: new Date('2026-01-01'),
      },
      { transaction: tx },
    );

    const [values, opts] = (models.fraudCaseEventModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({ fraudCaseId: 'c1', eventType: 'fraud_decision_recorded', payloadJson: { decision: 'blocked' } });
    expect(opts).toEqual({ transaction: tx });
  });

  it('createWatchlistEntry fija scope/status/source y createdByType internos', async () => {
    const { repo, models } = buildRepo();
    await repo.createWatchlistEntry(
      {
        tenantId: 't1',
        entityType: 'phone',
        entityHash: 'hash',
        entityLast4: '1234',
        reasonCode: 'confirmed_fraud',
        severity: 'high',
        actorInternalUserId: 'u1',
        createdAt: new Date('2026-01-01'),
      },
      { transaction: tx },
    );

    const [values] = (models.watchlistEntryModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({
      entityType: 'phone',
      entityHash: 'hash',
      scope: 'tenant',
      status: 'active',
      sourceType: 'fraud_decision',
      createdByType: 'internal_user',
      createdByInternalUserId: 'u1',
      deleted: false,
    });
  });

  it('createStatusEvent mapea el actor a changedByType', async () => {
    const { repo, models } = buildRepo();
    await repo.createStatusEvent(
      {
        tenantId: 't1',
        customerId: 'cust1',
        previousStatus: null,
        newStatus: 'blocked',
        reasonCode: 'confirmed_fraud',
        actorType: 'fraud_analyst',
        actorInternalUserId: 'u1',
        happenedAt: new Date('2026-01-01'),
        notes: null,
      },
      { transaction: tx },
    );

    const [values] = (models.customerStatusEventModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({
      customerId: 'cust1',
      newStatus: 'blocked',
      changedByType: 'fraud_analyst',
      changedByInternalUserId: 'u1',
    });
  });

  it('createCustomerObservation guarda el payload en valueJson con verificación operator_decision', async () => {
    const { repo, models } = buildRepo();
    await repo.createCustomerObservation(
      {
        tenantId: 't1',
        customerId: 'cust1',
        observationCode: 'fraud_decision',
        payload: { decision: 'blocked' },
        happenedAt: new Date('2026-01-01'),
      },
      { transaction: tx },
    );

    const [values] = (models.customerObservationModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({
      observationCode: 'fraud_decision',
      valueJson: { decision: 'blocked' },
      verificationStatus: 'operator_decision',
    });
  });

  it('createOperationalAudit mapea payload->payloadJson y happenedAt->occurredAt', async () => {
    const { repo, models } = buildRepo();
    await repo.createOperationalAudit(
      {
        tenantId: 't1',
        actorType: 'fraud_analyst',
        actorInternalUserId: 'u1',
        actionCode: 'operations.fraud.decision',
        targetType: 'fraud_case',
        targetId: 'c1',
        payload: { decision: 'blocked' },
        happenedAt: new Date('2026-01-01'),
      },
      { transaction: tx },
    );

    const [values] = (models.operationalAuditLogModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({ actionCode: 'operations.fraud.decision', targetId: 'c1', payloadJson: { decision: 'blocked' } });
    expect(values.occurredAt).toEqual(new Date('2026-01-01'));
  });

  it('createDataChange mapea reason->changeReason y actor->changedByType', async () => {
    const { repo, models } = buildRepo();
    await repo.createDataChange(
      {
        tenantId: 't1',
        tableName: 'fraud_cases',
        recordId: 'c1',
        changeType: 'decision',
        actorType: 'fraud_analyst',
        actorInternalUserId: 'u1',
        reason: 'confirmed_fraud',
        happenedAt: new Date('2026-01-01'),
      },
      { transaction: tx },
    );

    const [values] = (models.dataChangeLogModel.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({
      tableName: 'fraud_cases',
      changeType: 'decision',
      changeReason: 'confirmed_fraud',
      changedByType: 'fraud_analyst',
    });
  });
});
