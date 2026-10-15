import { describe, expect, it, jest } from '@jest/globals';
import { SchemaChangeLogRepository } from '../../../src/modules/schema-management/schema-change-log.repository.js';

/** Cobertura directa de `SchemaChangeLogRepository`: auditoría de propuestas con su lock pesimista. */
describe('SchemaChangeLogRepository', () => {
  function buildChangeLogRepo() {
    const sequelize = { query: jest.fn(), transaction: jest.fn(async (cb: (tx: string) => unknown) => cb('tx')) };
    const repo = new SchemaChangeLogRepository(sequelize as never);
    return { repo, sequelize };
  }

  describe('change log', () => {
    it('createChangeLogEntry devuelve la fila creada y lanza si el INSERT no retorna nada', async () => {
      const ok = buildChangeLogRepo();
      (ok.sequelize.query as jest.Mock).mockResolvedValue([{ _id: 'c1', change_type: 'create_table' }] as never);
      const created = await ok.repo.createChangeLogEntry({
        changeType: 'create_table',
        affectedEntityType: 'table',
        changePayload: { a: 1 },
        requesterPlatformUserId: 'p1',
        requesterInternalUserId: null,
      });
      expect(created).toMatchObject({ _id: 'c1' });

      const bad = buildChangeLogRepo();
      (bad.sequelize.query as jest.Mock).mockResolvedValue([] as never);
      await expect(
        bad.repo.createChangeLogEntry({
          changeType: 'x',
          affectedEntityType: 'y',
          changePayload: {},
          requesterPlatformUserId: 'p1',
          requesterInternalUserId: null,
        }),
      ).rejects.toThrow('Failed to insert');
    });

    it('listChangeLog arma el WHERE dinámico desde los filtros presentes', async () => {
      const all = buildChangeLogRepo();
      (all.sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 'c1' }] as never).mockResolvedValueOnce([{ count: '1' }] as never);
      await all.repo.listChangeLog({ approvalStatus: 'pending', changeType: 'create_table', requesterUserId: 'p1' }, 10, 0);
      const sql = (all.sequelize.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('approval_status = :approvalStatus');
      expect(sql).toContain('change_type = :changeType');
      expect(sql).toContain('requester_platform_user_id = :requesterUserId');
      // El id del filtro puede ser de cualquiera de las dos poblaciones (hallazgo A4).
      expect(sql).toContain('requester_internal_user_id = :requesterUserId');

      const none = buildChangeLogRepo();
      (none.sequelize.query as jest.Mock).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: '0' }] as never);
      await none.repo.listChangeLog({}, 10, 0);
      expect((none.sequelize.query as jest.Mock).mock.calls[0][0] as string).not.toContain('WHERE');
    });

    it('resolveChangeLogEntry devuelve la fila actualizada o null', async () => {
      const found = buildChangeLogRepo();
      (found.sequelize.query as jest.Mock).mockResolvedValue([{ _id: 'c1', approval_status: 'approved' }] as never);
      expect(
        await found.repo.resolveChangeLogEntry('c1', {
          approvalStatus: 'approved',
          approvedByPlatformUserId: 'p1',
          approvedByInternalUserId: null,
          approvalNotes: null,
          changeResult: 'success',
          errorMessage: null,
        }),
      ).toMatchObject({ approval_status: 'approved' });

      const missing = buildChangeLogRepo();
      (missing.sequelize.query as jest.Mock).mockResolvedValue([] as never);
      expect(
        await missing.repo.resolveChangeLogEntry('nope', {
          approvalStatus: 'rejected',
          approvedByPlatformUserId: 'p1',
          approvedByInternalUserId: null,
          approvalNotes: 'no',
          changeResult: 'rejected',
          errorMessage: null,
        }),
      ).toBeNull();
    });
  });

  it('withTransaction delega en sequelize.transaction', async () => {
    const { repo, sequelize } = buildChangeLogRepo();
    const result = await repo.withTransaction(async () => 'done');
    expect(result).toBe('done');
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });
});
