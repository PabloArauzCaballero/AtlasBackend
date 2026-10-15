/**
 * @file Puerto de persistencia: tablas, columnas y relaciones del catálogo de esquema.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system SQL parametrizado sobre schema_tables, schema_columns y schema_relationships.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import type {
  SchemaColumnRow,
  SchemaNameSummaryRow,
  SchemaRelationshipRow,
  SchemaTableCounts,
  SchemaTableRow,
} from './schema-management.rows.js';

interface CountRow {
  count: string;
}

interface GroupedTableCountRow {
  schema_table_id: string;
  count: string;
}

/**
 * Decisiones de robustez: filtros dinámicos construidos solo desde valores validados por Zod y aun así
 * pasados como `replacements`; nunca se concatenan datos del cliente dentro del SQL.
 */
@Injectable()
export class SchemaTablesRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async getSchemaTable(tableId: string): Promise<SchemaTableRow | null> {
    const rows = await this.sequelize.query<SchemaTableRow>(
      `SELECT _id, schema_version_id, table_name, table_type, is_append_only,
              is_tenant_scoped, description, created_at, is_deleted
       FROM schema_tables
       WHERE _id = :tableId AND is_deleted = false`,
      { type: QueryTypes.SELECT, replacements: { tableId } },
    );
    return rows[0] ?? null;
  }

  async listSchemaTables(
    versionId: string,
    tableType: string | undefined,
    limit: number,
    offset: number,
    { schemaName, q }: { schemaName?: string; q?: string } = {},
  ): Promise<{ rows: SchemaTableRow[]; total: number }> {
    // tableType proviene de un enum Zod ya validado; aun así va como replacement.
    const typeFilter = tableType ? 'AND table_type = :tableType' : '';
    // El prefijo se compara sobre el nombre cualificado. `schemaName` ya pasó la regex de Zod, y
    // aun así viaja como replacement: nunca se concatena entrada del cliente dentro del SQL.
    const schemaFilter = schemaName ? 'AND table_name LIKE :schemaPrefix' : '';
    const schemaPrefix = schemaName ? `${schemaName}.%` : undefined;
    // Buscador: nombre cualificado de la tabla o su descripción. Antes el inventario no tenía otro
    // camino que elegir un esquema y recorrer las páginas.
    const textFilter = q ? 'AND (table_name ILIKE :q OR description ILIKE :q)' : '';
    const pattern = q ? containsLikePattern(q) : undefined;

    const rows = await this.sequelize.query<SchemaTableRow>(
      `SELECT _id, schema_version_id, table_name, table_type, is_append_only,
              is_tenant_scoped, description, created_at, is_deleted
       FROM schema_tables
       WHERE schema_version_id = :versionId AND is_deleted = false ${typeFilter} ${schemaFilter} ${textFilter}
       ORDER BY table_name ASC
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: { versionId, tableType, schemaPrefix, q: pattern, limit, offset } },
    );

    const countRows = await this.sequelize.query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM schema_tables
       WHERE schema_version_id = :versionId AND is_deleted = false ${typeFilter} ${schemaFilter} ${textFilter}`,
      { type: QueryTypes.SELECT, replacements: { versionId, tableType, schemaPrefix, q: pattern } },
    );

    return { rows, total: Number(countRows[0]?.count ?? '0') };
  }

  /**
   * Los ESQUEMAS de datos de una versión, con lo que contiene cada uno.
   *
   * Es el índice por el que se navega el catálogo: trece esquemas se leen de un vistazo, ciento
   * cincuenta tablas no. Sale de una agregación sobre el prefijo del nombre cualificado, así que no
   * necesita ninguna tabla nueva.
   */
  async listSchemaNamesForVersion(versionId: string): Promise<SchemaNameSummaryRow[]> {
    return this.sequelize.query<SchemaNameSummaryRow>(
      `SELECT split_part(st.table_name, '.', 1) AS schema_name,
              COUNT(DISTINCT st._id)::text AS tables_count,
              COUNT(sc._id)::text AS columns_count
       FROM schema_tables st
       LEFT JOIN schema_columns sc ON sc.schema_table_id = st._id AND sc.is_deleted = false
       WHERE st.schema_version_id = :versionId AND st.is_deleted = false
       GROUP BY 1
       ORDER BY 1 ASC`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
  }

  /**
   * Columnas y relaciones por tabla, para una PÁGINA de tablas.
   *
   * `listSchemaTables` devolvía cada fila con `columnsCount: 0` y `relationshipsCount: 0` fijos —
   * solo el detalle de UNA tabla los calculaba—, así que el inventario de una versión afirmaba que
   * las 152 tablas del esquema no tenían ni una columna. Es el mismo patrón por lotes que ya usa
   * `countTablesColumnsRelationshipsForVersions`: dos consultas agregadas para la página entera en
   * lugar de dos `COUNT(*)` por fila.
   */
  async countColumnsAndRelationshipsForTables(tableIds: readonly string[]): Promise<Map<string, SchemaTableCounts>> {
    const counts = new Map<string, SchemaTableCounts>();
    if (tableIds.length === 0) return counts;
    for (const tableId of tableIds) {
      counts.set(tableId, { columnsCount: 0, relationshipsCount: 0 });
    }

    const replacements = { tableIds: [...tableIds] };
    const [columnRows, relationshipRows] = await Promise.all([
      this.sequelize.query<GroupedTableCountRow>(
        `SELECT schema_table_id, COUNT(*)::text AS count
         FROM schema_columns
         WHERE schema_table_id IN (:tableIds) AND is_deleted = false
         GROUP BY schema_table_id`,
        { type: QueryTypes.SELECT, replacements },
      ),
      this.sequelize.query<GroupedTableCountRow>(
        `SELECT source_table_id AS schema_table_id, COUNT(*)::text AS count
         FROM schema_relationships
         WHERE source_table_id IN (:tableIds)
         GROUP BY source_table_id`,
        { type: QueryTypes.SELECT, replacements },
      ),
    ]);

    for (const row of columnRows) {
      const entry = counts.get(row.schema_table_id);
      if (entry) entry.columnsCount = Number(row.count);
    }
    for (const row of relationshipRows) {
      const entry = counts.get(row.schema_table_id);
      if (entry) entry.relationshipsCount = Number(row.count);
    }

    return counts;
  }

  async getSchemaColumns(tableId: string): Promise<SchemaColumnRow[]> {
    return this.sequelize.query<SchemaColumnRow>(
      `SELECT _id, schema_table_id, column_name, column_type, is_nullable, is_immutable,
              is_pii, is_indexed, default_value, description, is_deleted
       FROM schema_columns
       WHERE schema_table_id = :tableId AND is_deleted = false
       ORDER BY _id ASC`,
      { type: QueryTypes.SELECT, replacements: { tableId } },
    );
  }

  async getSchemaRelationshipsForTable(tableId: string): Promise<SchemaRelationshipRow[]> {
    return this.sequelize.query<SchemaRelationshipRow>(
      `SELECT sr._id, sr.schema_version_id, sr.source_table_id, sr.source_column_name,
              sr.target_table_id, tt.table_name AS target_table_name,
              sr.target_column_name, sr.cascade_delete, sr.is_immutable
       FROM schema_relationships sr
       LEFT JOIN schema_tables tt ON tt._id = sr.target_table_id
       WHERE sr.source_table_id = :tableId
       ORDER BY sr._id ASC`,
      { type: QueryTypes.SELECT, replacements: { tableId } },
    );
  }
}
