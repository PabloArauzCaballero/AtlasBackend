/**
 * @file Servicio de aplicación: consulta del inventario de esquema (versiones, tablas, columnas y relaciones).
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { SchemaTablesRepository } from '../schema-tables.repository.js';
import { SchemaVersionsRepository } from '../schema-versions.repository.js';
import type { SchemaVersionCounts, SchemaVersionRow } from '../schema-management.rows.js';
import { mapTableRow, mapVersionRowWithCounts } from './schema-management.mapper.js';
import {
  SchemaColumnDto,
  SchemaNamesListResponseDto,
  SchemaRelationshipDto,
  SchemaTableDto,
  SchemaTablesListResponseDto,
  SchemaVersionDto,
  SchemaVersionListResponseDto,
} from '../schema-management.dtos.js';

/** Lectura del inventario: sin efectos, sin actor; los permisos los exige el controlador. */
@Injectable()
export class SchemaCatalogService {
  constructor(
    private readonly versions: SchemaVersionsRepository,
    private readonly tables: SchemaTablesRepository,
  ) {}

  // =========================================================================
  // VERSIONS
  // =========================================================================

  async listSchemaVersions(limit = 20, offset = 0, includeInactive = false, q?: string): Promise<SchemaVersionListResponseDto> {
    const { rows, total } = await this.versions.listSchemaVersions(limit, offset, includeInactive, q);

    // Batch: 3 queries agregadas (GROUP BY schema_version_id) para toda la página, en vez de 3
    // COUNT(*) por fila vía mapVersionRow (hasta 60 queries para una página de 20).
    const countsByVersion = await this.versions.countTablesColumnsRelationshipsForVersions(rows.map((row) => row._id));
    const emptyCounts: SchemaVersionCounts = { tablesCount: 0, columnsCount: 0, relationshipsCount: 0 };
    const versions = rows.map((row) => mapVersionRowWithCounts(row, countsByVersion.get(row._id) ?? emptyCounts));

    return { versions, total, limit, offset };
  }

  async getSchemaVersion(versionId: string): Promise<SchemaVersionDto> {
    const row = await this.versions.getSchemaVersion(versionId);
    if (!row) {
      throw new NotFoundException(`Schema version ${versionId} not found`);
    }
    return this.mapVersionRow(row);
  }

  // =========================================================================
  // TABLES
  // =========================================================================

  /**
   * Los esquemas de datos de una versión. Es el primer nivel de la navegación del catálogo: se
   * elige un esquema y solo entonces se listan sus tablas.
   */
  async listSchemaNames(versionId: string): Promise<SchemaNamesListResponseDto> {
    const version = await this.versions.getSchemaVersion(versionId);
    if (!version) {
      throw new NotFoundException(`Schema version ${versionId} not found`);
    }

    const rows = await this.tables.listSchemaNamesForVersion(versionId);
    return {
      versionId,
      schemas: rows.map((row) => ({
        schemaName: row.schema_name,
        tablesCount: Number(row.tables_count),
        columnsCount: Number(row.columns_count),
      })),
    };
  }

  async listSchemaTables(
    versionId: string,
    tableType: string | undefined,
    limit = 50,
    offset = 0,
    filters: { schemaName?: string; q?: string } = {},
  ): Promise<SchemaTablesListResponseDto> {
    const version = await this.versions.getSchemaVersion(versionId);
    if (!version) {
      throw new NotFoundException(`Schema version ${versionId} not found`);
    }

    const { rows, total } = await this.tables.listSchemaTables(versionId, tableType, limit, offset, filters);
    // Los contadores se rellenan por lotes para la página: `mapTableRow` los deja en 0 y sin este
    // paso el inventario declaraba que ninguna tabla del esquema tenía columnas ni relaciones.
    const countsByTable = await this.tables.countColumnsAndRelationshipsForTables(rows.map((row) => row._id));
    const tables = rows.map((row) => {
      const dto = mapTableRow(row);
      const counts = countsByTable.get(row._id);
      if (counts) {
        dto.columnsCount = counts.columnsCount;
        dto.relationshipsCount = counts.relationshipsCount;
      }
      return dto;
    });

    return { tables, total, limit, offset, versionId, ...(filters.schemaName ? { schemaName: filters.schemaName } : {}) };
  }

  async getSchemaTable(tableId: string): Promise<SchemaTableDto> {
    const table = await this.tables.getSchemaTable(tableId);
    if (!table) {
      throw new NotFoundException(`Schema table ${tableId} not found`);
    }

    const [columns, relationships] = await Promise.all([
      this.tables.getSchemaColumns(tableId),
      this.tables.getSchemaRelationshipsForTable(tableId),
    ]);

    const dto = mapTableRow(table);
    dto.columnsCount = columns.length;
    dto.relationshipsCount = relationships.length;

    dto.columns = columns.map((col) => {
      const colDto = new SchemaColumnDto();
      colDto._id = col._id;
      colDto.columnName = col.column_name;
      colDto.columnType = col.column_type;
      colDto.isNullable = col.is_nullable;
      colDto.isImmutable = col.is_immutable;
      colDto.isPii = col.is_pii;
      colDto.isIndexed = col.is_indexed;
      colDto.description = col.description;
      return colDto;
    });

    dto.relationships = relationships.map((rel) => {
      const relDto = new SchemaRelationshipDto();
      relDto._id = rel._id;
      relDto.sourceColumnName = rel.source_column_name;
      relDto.targetTableName = rel.target_table_name ?? 'unknown';
      relDto.targetColumnName = rel.target_column_name;
      relDto.cascadeDelete = rel.cascade_delete;
      relDto.isImmutable = rel.is_immutable;
      return relDto;
    });

    return dto;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private async mapVersionRow(row: SchemaVersionRow): Promise<SchemaVersionDto> {
    const [tablesCount, columnsCount, relationshipsCount] = await Promise.all([
      this.versions.countTablesInVersion(row._id),
      this.versions.countColumnsInVersion(row._id),
      this.versions.countRelationshipsInVersion(row._id),
    ]);
    return mapVersionRowWithCounts(row, { tablesCount, columnsCount, relationshipsCount });
  }
}
