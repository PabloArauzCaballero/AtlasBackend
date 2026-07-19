import { describe, expect, it, jest } from '@jest/globals';
import { SchemaManagementRepository } from '../../../src/modules/schema-management/schema-management.repository.js';

/**
 * Cobertura directa de `SchemaManagementRepository` (Fase 1.2 del plan 10/10). Es un repositorio de
 * consultas SQL crudas sobre el catálogo de esquema; se mockea `sequelize.query` y se verifica el
 * mapeo de filas y, sobre todo, los fallbacks (COUNT nulo -> 0) y las ramas de filtro.
 */
describe('SchemaManagementRepository', () => {
  function buildRepo() {
    const sequelize = { query: jest.fn(), transaction: jest.fn(async (cb: (tx: string) => unknown) => cb('tx')) };
    const repo = new SchemaManagementRepository(sequelize as never);
    return { repo, sequelize };
  }

  describe('getSchemaVersion', () => {
    it('devuelve la primera fila cuando existe', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([{ _id: 'v1', version_code: 'V1' }] as never);
      const result = await repo.getSchemaVersion('v1');
      expect(result).toMatchObject({ _id: 'v1', version_code: 'V1' });
      expect((sequelize.query as jest.Mock).mock.calls[0][1]).toMatchObject({ replacements: { versionId: 'v1' } });
    });

    it('devuelve null cuando la consulta no trae filas', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      await expect(repo.getSchemaVersion('nope')).resolves.toBeNull();
    });
  });

  describe('listSchemaVersions', () => {
    it('con includeInactive=false filtra por is_active=true y devuelve el total', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock)
        .mockResolvedValueOnce([{ _id: 'v1' }] as never) // filas
        .mockResolvedValueOnce([{ count: '1' }] as never); // count

      const result = await repo.listSchemaVersions(10, 0, false);
      expect(result).toEqual({ rows: [{ _id: 'v1' }], total: 1 });
      const listSql = (sequelize.query as jest.Mock).mock.calls[0][0] as string;
      expect(listSql).toContain('WHERE is_active = true');
    });

    it('con includeInactive=true NO aplica el filtro is_active', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: '0' }] as never);
      await repo.listSchemaVersions(10, 0, true);
      const listSql = (sequelize.query as jest.Mock).mock.calls[0][0] as string;
      expect(listSql).not.toContain('is_active = true');
    });

    it('total cae a 0 si el COUNT no trae fila', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
      const result = await repo.listSchemaVersions(10, 0, false);
      expect(result.total).toBe(0);
    });
  });

  describe('conteos por versión', () => {
    it('countTablesInVersion parsea el COUNT a número', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([{ count: '42' }] as never);
      await expect(repo.countTablesInVersion('v1')).resolves.toBe(42);
    });

    it('countColumnsInVersion cae a 0 cuando no hay fila (fallback)', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      await expect(repo.countColumnsInVersion('v1')).resolves.toBe(0);
    });

    it('countRelationshipsInVersion pasa el versionId como replacement', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([{ count: '3' }] as never);
      await expect(repo.countRelationshipsInVersion('v9')).resolves.toBe(3);
      expect((sequelize.query as jest.Mock).mock.calls[0][1]).toMatchObject({ replacements: { versionId: 'v9' } });
    });
  });

  describe('countTablesColumnsRelationshipsForVersions', () => {
    it('corta con lista vacía (sin query)', async () => {
      const { repo, sequelize } = buildRepo();
      const map = await repo.countTablesColumnsRelationshipsForVersions([]);
      expect(map.size).toBe(0);
      expect(sequelize.query).not.toHaveBeenCalled();
    });

    it('agrega los 3 conteos por versión y deja 0 donde no hay filas', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock)
        .mockResolvedValueOnce([{ schema_version_id: 'v1', count: '2' }] as never) // tablas
        .mockResolvedValueOnce([{ schema_version_id: 'v1', count: '5' }] as never) // columnas
        .mockResolvedValueOnce([] as never); // relaciones
      const map = await repo.countTablesColumnsRelationshipsForVersions(['v1', 'v2']);
      expect(map.get('v1')).toEqual({ tablesCount: 2, columnsCount: 5, relationshipsCount: 0 });
      expect(map.get('v2')).toEqual({ tablesCount: 0, columnsCount: 0, relationshipsCount: 0 });
    });
  });

  describe('schema tables / columns / relationships', () => {
    it('listSchemaTables aplica el filtro de tipo solo cuando se provee', async () => {
      const withType = buildRepo();
      (withType.sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 't1' }] as never).mockResolvedValueOnce([{ count: '1' }] as never);
      const res = await withType.repo.listSchemaTables('v1', 'catalog', 10, 0);
      expect(res).toEqual({ rows: [{ _id: 't1' }], total: 1 });
      expect((withType.sequelize.query as jest.Mock).mock.calls[0][0] as string).toContain('AND table_type = :tableType');

      const noType = buildRepo();
      (noType.sequelize.query as jest.Mock).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: '0' }] as never);
      await noType.repo.listSchemaTables('v1', undefined, 10, 0);
      expect((noType.sequelize.query as jest.Mock).mock.calls[0][0] as string).not.toContain('table_type = :tableType');
    });

    it('getSchemaTable devuelve fila o null; getSchemaColumns/Relationships devuelven el array', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 't1' }] as never);
      expect(await repo.getSchemaTable('t1')).toMatchObject({ _id: 't1' });
      (sequelize.query as jest.Mock).mockResolvedValueOnce([] as never);
      expect(await repo.getSchemaTable('nope')).toBeNull();
      (sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 'c1' }] as never);
      expect(await repo.getSchemaColumns('t1')).toEqual([{ _id: 'c1' }]);
      (sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 'r1' }] as never);
      expect(await repo.getSchemaRelationshipsForTable('t1')).toEqual([{ _id: 'r1' }]);
    });
  });

  describe('change log', () => {
    it('createChangeLogEntry devuelve la fila creada y lanza si el INSERT no retorna nada', async () => {
      const ok = buildRepo();
      (ok.sequelize.query as jest.Mock).mockResolvedValue([{ _id: 'c1', change_type: 'create_table' }] as never);
      const created = await ok.repo.createChangeLogEntry({ changeType: 'create_table', affectedEntityType: 'table', changePayload: { a: 1 }, requesterPlatformUserId: 'p1' });
      expect(created).toMatchObject({ _id: 'c1' });

      const bad = buildRepo();
      (bad.sequelize.query as jest.Mock).mockResolvedValue([] as never);
      await expect(bad.repo.createChangeLogEntry({ changeType: 'x', affectedEntityType: 'y', changePayload: {}, requesterPlatformUserId: 'p1' })).rejects.toThrow('Failed to insert');
    });

    it('listChangeLog arma el WHERE dinámico desde los filtros presentes', async () => {
      const all = buildRepo();
      (all.sequelize.query as jest.Mock).mockResolvedValueOnce([{ _id: 'c1' }] as never).mockResolvedValueOnce([{ count: '1' }] as never);
      await all.repo.listChangeLog('pending', 'create_table', 'p1', 10, 0);
      const sql = (all.sequelize.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('approval_status = :approvalStatus');
      expect(sql).toContain('change_type = :changeType');
      expect(sql).toContain('requester_platform_user_id = :requesterUserId');

      const none = buildRepo();
      (none.sequelize.query as jest.Mock).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: '0' }] as never);
      await none.repo.listChangeLog(undefined, undefined, undefined, 10, 0);
      expect((none.sequelize.query as jest.Mock).mock.calls[0][0] as string).not.toContain('WHERE');
    });

    it('resolveChangeLogEntry devuelve la fila actualizada o null', async () => {
      const found = buildRepo();
      (found.sequelize.query as jest.Mock).mockResolvedValue([{ _id: 'c1', approval_status: 'approved' }] as never);
      expect(await found.repo.resolveChangeLogEntry('c1', { approvalStatus: 'approved', approvedByPlatformUserId: 'p1', approvalNotes: null, changeResult: 'success', errorMessage: null })).toMatchObject({ approval_status: 'approved' });

      const missing = buildRepo();
      (missing.sequelize.query as jest.Mock).mockResolvedValue([] as never);
      expect(await missing.repo.resolveChangeLogEntry('nope', { approvalStatus: 'rejected', approvedByPlatformUserId: 'p1', approvalNotes: 'no', changeResult: 'rejected', errorMessage: null })).toBeNull();
    });
  });

  it('withTransaction delega en sequelize.transaction', async () => {
    const { repo, sequelize } = buildRepo();
    const result = await repo.withTransaction(async () => 'done');
    expect(result).toBe('done');
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });
});
