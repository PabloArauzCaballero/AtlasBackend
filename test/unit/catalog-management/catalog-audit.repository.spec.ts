import { describe, expect, it, jest } from '@jest/globals';
import { CatalogAuditRepository } from '../../../src/modules/catalog-management/catalog-audit.repository.js';

/** Verifica que la auditoría mapea el payload y hashea los valores nuevos. */
describe('CatalogAuditRepository', () => {
  function buildRepo() {
    const models = {
      auditModel: { create: jest.fn(async (..._args: unknown[]) => ({})) },
      dataChangeLogModel: { create: jest.fn(async (..._args: unknown[]) => ({})) },
    };
    const repo = new CatalogAuditRepository(models.auditModel as never, models.dataChangeLogModel as never);
    return { repo, models };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');

  it('createAudit mapea el payload a payloadJson y copia occurredAt a createdAtValue', async () => {
    const { repo, models } = buildRepo();
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'internal_user',
        actorInternalUserId: 'u1',
        actorPlatformUserId: null,
        actionCode: 'CATALOG_PUBLISH',
        targetType: 'catalog',
        targetId: 'c1',
        ipAddress: null,
        userAgent: null,
        payload: { foo: 'bar' },
        occurredAt: now,
      },
      {},
    );
    const [values] = (models.auditModel.create as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(values).toMatchObject({
      tenantId: 't1',
      actionCode: 'CATALOG_PUBLISH',
      payloadJson: { foo: 'bar' },
      occurredAt: now,
      createdAtValue: now,
    });
  });

  it('createDataChange hashea newValues cuando existen y deja null si no', async () => {
    const { repo, models } = buildRepo();
    const base = {
      tenantId: 't1',
      tableName: 'context_items',
      recordId: 'r1',
      changeType: 'update',
      actorType: 'internal_user',
      actorInternalUserId: 'u1',
      actorPlatformUserId: null,
      reason: 'fix',
      happenedAt: now,
    };
    await repo.createDataChange({ ...base, newValues: { a: 1 } }, {});
    await repo.createDataChange({ ...base }, {});
    const calls = (models.dataChangeLogModel.create as jest.Mock).mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0][0].newValuesHash).toEqual(expect.any(String));
    expect(calls[0][0].oldValuesHash).toBeNull();
    expect(calls[1][0].newValuesHash).toBeNull();
  });
});
