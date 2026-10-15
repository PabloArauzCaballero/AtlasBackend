/**
 * @file Puerto de persistencia: versiones del catálogo de esquema y sus conteos.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system SQL parametrizado sobre schema_versions con conteos agregados de tablas, columnas y relaciones.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import type { SchemaVersionCounts, SchemaVersionRow } from './schema-management.rows.js';

interface CountRow {
  count: string;
}

interface GroupedCountRow {
  schema_version_id: string;
  count: string;
}

/**
 * Decisiones de robustez: SQL 100% parametrizado con `replacements`, columnas explícitas y
 * `QueryTypes` en cada query.
 */
@Injectable()
export class SchemaVersionsRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async getSchemaVersion(versionId: string): Promise<SchemaVersionRow | null> {
    const rows = await this.sequelize.query<SchemaVersionRow>(
      `SELECT _id, version_code, created_by_platform_user_id, created_at, notes, is_active, parent_version_id
       FROM schema_versions
       WHERE _id = :versionId`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
    return rows[0] ?? null;
  }

  async listSchemaVersions(
    limit: number,
    offset: number,
    includeInactive: boolean,
    q?: string,
  ): Promise<{ rows: SchemaVersionRow[]; total: number }> {
    const filters = [...(includeInactive ? [] : ['is_active = true']), ...(q ? ['(version_code ILIKE :q OR notes ILIKE :q)'] : [])];
    const activeFilter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const pattern = q ? containsLikePattern(q) : undefined;

    const rows = await this.sequelize.query<SchemaVersionRow>(
      `SELECT _id, version_code, created_by_platform_user_id, created_at, notes, is_active, parent_version_id
       FROM schema_versions
       ${activeFilter}
       ORDER BY created_at DESC, _id DESC
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: { limit, offset, q: pattern } },
    );

    const countRows = await this.sequelize.query<CountRow>(`SELECT COUNT(*)::text AS count FROM schema_versions ${activeFilter}`, {
      type: QueryTypes.SELECT,
      replacements: { q: pattern },
    });

    return { rows, total: Number(countRows[0]?.count ?? '0') };
  }

  async countTablesInVersion(versionId: string): Promise<number> {
    const rows = await this.sequelize.query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM schema_tables
       WHERE schema_version_id = :versionId AND is_deleted = false`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
    return Number(rows[0]?.count ?? '0');
  }

  async countColumnsInVersion(versionId: string): Promise<number> {
    const rows = await this.sequelize.query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM schema_columns sc
       JOIN schema_tables st ON st._id = sc.schema_table_id
       WHERE st.schema_version_id = :versionId
         AND st.is_deleted = false
         AND sc.is_deleted = false`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
    return Number(rows[0]?.count ?? '0');
  }

  async countRelationshipsInVersion(versionId: string): Promise<number> {
    const rows = await this.sequelize.query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM schema_relationships
       WHERE schema_version_id = :versionId`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
    return Number(rows[0]?.count ?? '0');
  }

  /**
   * Batch de `countTablesInVersion`/`countColumnsInVersion`/`countRelationshipsInVersion` para
   * varias versiones a la vez — usada por `listSchemaVersions` para no disparar 3 COUNT(*) por
   * fila de la página (hasta 60 queries para una página de 20). 3 queries agregadas con
   * `GROUP BY schema_version_id`, filtradas a las versiones pedidas, en vez de 3*N queries.
   */
  async countTablesColumnsRelationshipsForVersions(versionIds: readonly string[]): Promise<Map<string, SchemaVersionCounts>> {
    const counts = new Map<string, SchemaVersionCounts>();
    if (versionIds.length === 0) return counts;
    for (const versionId of versionIds) {
      counts.set(versionId, { tablesCount: 0, columnsCount: 0, relationshipsCount: 0 });
    }

    const replacements = { versionIds: [...versionIds] };
    const [tableRows, columnRows, relationshipRows] = await Promise.all([
      this.sequelize.query<GroupedCountRow>(
        `SELECT schema_version_id, COUNT(*)::text AS count
         FROM schema_tables
         WHERE schema_version_id IN (:versionIds) AND is_deleted = false
         GROUP BY schema_version_id`,
        { type: QueryTypes.SELECT, replacements },
      ),
      this.sequelize.query<GroupedCountRow>(
        `SELECT st.schema_version_id AS schema_version_id, COUNT(*)::text AS count
         FROM schema_columns sc
         JOIN schema_tables st ON st._id = sc.schema_table_id
         WHERE st.schema_version_id IN (:versionIds)
           AND st.is_deleted = false
           AND sc.is_deleted = false
         GROUP BY st.schema_version_id`,
        { type: QueryTypes.SELECT, replacements },
      ),
      this.sequelize.query<GroupedCountRow>(
        `SELECT schema_version_id, COUNT(*)::text AS count
         FROM schema_relationships
         WHERE schema_version_id IN (:versionIds)
         GROUP BY schema_version_id`,
        { type: QueryTypes.SELECT, replacements },
      ),
    ]);

    for (const row of tableRows) {
      const entry = counts.get(row.schema_version_id);
      if (entry) entry.tablesCount = Number(row.count);
    }
    for (const row of columnRows) {
      const entry = counts.get(row.schema_version_id);
      if (entry) entry.columnsCount = Number(row.count);
    }
    for (const row of relationshipRows) {
      const entry = counts.get(row.schema_version_id);
      if (entry) entry.relationshipsCount = Number(row.count);
    }

    return counts;
  }
}
