import { describe, expect, it, jest } from '@jest/globals';
import { SchemaTablesRepository } from '../../../src/modules/schema-management/schema-tables.repository.js';

/** Cobertura directa de `SchemaTablesRepository`: tablas, columnas y relaciones del catálogo (SQL crudo mockeado). */
describe('SchemaTablesRepository', () => {
  function buildRepo() {
    const sequelize = { query: jest.fn() };
    const repo = new SchemaTablesRepository(sequelize as never);
    return { repo, sequelize };
  }

  describe('tablas / columnas / relaciones', () => {
    it('listSchemaTables aplica el filtro de tipo solo cuando se provee', async () => {
      const withType = buildRepo();
      (withType.sequelize.query as jest.Mock)
        .mockResolvedValueOnce([{ _id: 't1' }] as never)
        .mockResolvedValueOnce([{ count: '1' }] as never);
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
});
