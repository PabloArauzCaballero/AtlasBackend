import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { asyncMock, type AsyncMock } from '../../support/jest-mocks.js';
import { NotFoundException } from '@nestjs/common';
import { SchemaCatalogService } from '../../../src/modules/schema-management/services/schema-catalog.service.js';
import type { SchemaTablesRepository } from '../../../src/modules/schema-management/schema-tables.repository.js';
import type { SchemaVersionsRepository } from '../../../src/modules/schema-management/schema-versions.repository.js';
import type { SchemaVersionRow } from '../../../src/modules/schema-management/schema-management.rows.js';

/**
 * Lectura del inventario de esquema (código REAL con repos mockeados). Un solo doble cubre los dos
 * repositorios: el reparto entre versiones y tablas es organización interna.
 */
type RepoMock = {
  [K in keyof SchemaVersionsRepository]: AsyncMock;
} & {
  [K in keyof SchemaTablesRepository]: AsyncMock;
};

function makeRepoMock(): RepoMock {
  return {
    getSchemaVersion: asyncMock(),
    listSchemaVersions: asyncMock(),
    countTablesInVersion: jest.fn(async (..._args: unknown[]) => 0),
    countColumnsInVersion: jest.fn(async (..._args: unknown[]) => 0),
    countRelationshipsInVersion: jest.fn(async (..._args: unknown[]) => 0),
    countTablesColumnsRelationshipsForVersions: jest.fn(async (..._args: unknown[]) => new Map()),
    countColumnsAndRelationshipsForTables: jest.fn(async (..._args: unknown[]) => new Map()),
    listSchemaNamesForVersion: jest.fn(async (..._args: unknown[]) => []),
    getSchemaTable: asyncMock(),
    listSchemaTables: asyncMock(),
    getSchemaColumns: jest.fn(async (..._args: unknown[]) => []),
    getSchemaRelationshipsForTable: jest.fn(async (..._args: unknown[]) => []),
  } as unknown as RepoMock;
}

const baseVersionRow: SchemaVersionRow = {
  _id: '1',
  version_code: 'v1.0',
  created_by_platform_user_id: null,
  created_at: new Date('2026-07-06T00:00:00Z'),
  notes: 'Initial',
  is_active: true,
  parent_version_id: null,
};

describe('SchemaCatalogService', () => {
  let repo: RepoMock;
  let service: SchemaCatalogService;

  beforeEach(() => {
    repo = makeRepoMock();
    service = new SchemaCatalogService(repo as unknown as SchemaVersionsRepository, repo as unknown as SchemaTablesRepository);
  });

  describe('listSchemaVersions', () => {
    it('devuelve versiones con conteos reales de tablas/columnas/FK', async () => {
      repo.listSchemaVersions.mockResolvedValue({ rows: [baseVersionRow], total: 1 });
      repo.countTablesColumnsRelationshipsForVersions.mockResolvedValue(
        new Map([['1', { tablesCount: 121, columnsCount: 900, relationshipsCount: 140 }]]),
      );

      const result = await service.listSchemaVersions(20, 0, false);

      expect(result.total).toBe(1);
      expect(result.versions[0]?.versionCode).toBe('v1.0');
      expect(result.versions[0]?.tablesCount).toBe(121);
      expect(result.versions[0]?.columnsCount).toBe(900);
      expect(result.versions[0]?.relationshipsCount).toBe(140);
    });

    it('fetches counts for the whole page in a single batch call, not 3 COUNT(*) per version (N+1 regression)', async () => {
      const rows = [
        { ...baseVersionRow, _id: '1' },
        { ...baseVersionRow, _id: '2' },
        { ...baseVersionRow, _id: '3' },
      ];
      repo.listSchemaVersions.mockResolvedValue({ rows, total: 3 });

      await service.listSchemaVersions(20, 0, false);

      expect(repo.countTablesColumnsRelationshipsForVersions).toHaveBeenCalledTimes(1);
      expect(repo.countTablesColumnsRelationshipsForVersions).toHaveBeenCalledWith(['1', '2', '3']);
      expect(repo.countTablesInVersion).not.toHaveBeenCalled();
      expect(repo.countColumnsInVersion).not.toHaveBeenCalled();
      expect(repo.countRelationshipsInVersion).not.toHaveBeenCalled();
    });

    it('defaults counts to 0 for a version missing from the batch map', async () => {
      repo.listSchemaVersions.mockResolvedValue({ rows: [baseVersionRow], total: 1 });
      repo.countTablesColumnsRelationshipsForVersions.mockResolvedValue(new Map());

      const result = await service.listSchemaVersions(20, 0, false);

      expect(result.versions[0]).toMatchObject({ tablesCount: 0, columnsCount: 0, relationshipsCount: 0 });
    });
  });

  describe('getSchemaVersion', () => {
    it('lanza NotFound si la versión no existe', async () => {
      repo.getSchemaVersion.mockResolvedValue(null);
      await expect(service.getSchemaVersion('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSchemaTables', () => {
    it('lanza NotFound si la versión no existe (no lista tablas de versiones fantasma)', async () => {
      repo.getSchemaVersion.mockResolvedValue(null);
      await expect(service.listSchemaTables('999', undefined, 50, 0)).rejects.toThrow(NotFoundException);
      expect(repo.listSchemaTables).not.toHaveBeenCalled();
    });

    /**
     * `mapTableRow` deja los contadores en cero y sólo el detalle de UNA tabla los calculaba, así
     * que el inventario de una versión afirmaba que sus 152 tablas no tenían ni una columna.
     */
    it('rellena columnas y relaciones de cada fila, no las deja en cero', async () => {
      repo.getSchemaVersion.mockResolvedValue({ _id: '1', version_code: 'v1.0' });
      repo.listSchemaTables.mockResolvedValue({
        rows: [
          {
            _id: '7',
            schema_version_id: '1',
            table_name: 'iam.internal_users',
            table_type: 'transactional',
            is_append_only: false,
            is_tenant_scoped: true,
            description: null,
            created_at: new Date(),
            is_deleted: false,
          },
        ],
        total: 1,
      });
      repo.countColumnsAndRelationshipsForTables.mockResolvedValue(new Map([['7', { columnsCount: 14, relationshipsCount: 3 }]]));

      const result = await service.listSchemaTables('1', undefined, 50, 0);

      expect(result.tables[0].columnsCount).toBe(14);
      expect(result.tables[0].relationshipsCount).toBe(3);
    });

    it('propaga el filtro por esquema de datos al repositorio', async () => {
      repo.getSchemaVersion.mockResolvedValue({ _id: '1', version_code: 'v1.0' });
      repo.listSchemaTables.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.listSchemaTables('1', undefined, 50, 0, { schemaName: 'iam' });

      expect(repo.listSchemaTables).toHaveBeenCalledWith('1', undefined, 50, 0, { schemaName: 'iam' });
      expect(result.schemaName).toBe('iam');
    });

    it('sin filtro no se publica `schemaName`: no se afirma un acotado que no existe', async () => {
      repo.getSchemaVersion.mockResolvedValue({ _id: '1', version_code: 'v1.0' });
      repo.listSchemaTables.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.listSchemaTables('1', undefined, 50, 0);

      expect(result.schemaName).toBeUndefined();
    });
  });

  describe('listSchemaNames', () => {
    it('lanza NotFound si la versión no existe', async () => {
      repo.getSchemaVersion.mockResolvedValue(null);
      await expect(service.listSchemaNames('999')).rejects.toThrow(NotFoundException);
    });

    it('devuelve los esquemas con sus conteos como números', async () => {
      repo.getSchemaVersion.mockResolvedValue({ _id: '1', version_code: 'v1.0' });
      repo.listSchemaNamesForVersion.mockResolvedValue([
        { schema_name: 'iam', tables_count: '11', columns_count: '131' },
        { schema_name: 'risk', tables_count: '16', columns_count: '260' },
      ]);

      const result = await service.listSchemaNames('1');

      expect(result.schemas).toEqual([
        { schemaName: 'iam', tablesCount: 11, columnsCount: 131 },
        { schemaName: 'risk', tablesCount: 16, columnsCount: 260 },
      ]);
    });
  });

  describe('getSchemaTable', () => {
    it('lanza NotFound si la tabla no existe', async () => {
      repo.getSchemaTable.mockResolvedValue(null);
      await expect(service.getSchemaTable('999')).rejects.toThrow(NotFoundException);
    });

    it('incluye columnas y relaciones con FK marcadas inmutables', async () => {
      repo.getSchemaTable.mockResolvedValue({
        _id: '5',
        schema_version_id: '1',
        table_name: 'purchases',
        table_type: 'transactional',
        is_append_only: true,
        is_tenant_scoped: true,
        description: null,
        created_at: new Date(),
        is_deleted: false,
      });
      repo.getSchemaColumns.mockResolvedValue([
        {
          _id: '50',
          schema_table_id: '5',
          column_name: '_id',
          column_type: 'BIGSERIAL',
          is_nullable: false,
          is_immutable: true,
          is_pii: false,
          is_indexed: true,
          default_value: null,
          description: null,
          is_deleted: false,
        },
      ]);
      repo.getSchemaRelationshipsForTable.mockResolvedValue([
        {
          _id: '70',
          schema_version_id: '1',
          source_table_id: '5',
          source_column_name: 'customer_id',
          target_table_id: '2',
          target_table_name: 'customers',
          target_column_name: '_id',
          cascade_delete: false,
          is_immutable: true,
        },
      ]);

      const dto = await service.getSchemaTable('5');

      expect(dto.columns).toHaveLength(1);
      expect(dto.relationships).toHaveLength(1);
      expect(dto.relationships?.[0]?.isImmutable).toBe(true);
      expect(dto.relationships?.[0]?.targetTableName).toBe('customers');
    });
  });
});
