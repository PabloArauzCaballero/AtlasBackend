import { describe, expect, it, jest } from '@jest/globals';
import { SchemaManagementRepository } from '../../../src/modules/schema-management/schema-management.repository.js';

/**
 * Cobertura directa de `SchemaManagementRepository` (Fase 1.2 del plan 10/10). Es un repositorio de
 * consultas SQL crudas sobre el catálogo de esquema; se mockea `sequelize.query` y se verifica el
 * mapeo de filas y, sobre todo, los fallbacks (COUNT nulo -> 0) y las ramas de filtro.
 */
describe('SchemaManagementRepository', () => {
  function buildRepo() {
    const sequelize = { query: jest.fn() };
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
});
