import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * SchemaManagementRepository
 *
 * Acceso a datos para las 5 tablas de schema management (Fase 4A):
 * - schema_versions
 * - schema_tables
 * - schema_columns
 * - schema_relationships
 * - schema_change_log
 *
 * Decisiones de robustez a largo plazo:
 * - SQL 100% parametrizado con `replacements` (nunca interpolación de datos de usuario).
 * - Columnas SIEMPRE explícitas en INSERT/UPDATE (nunca construidas desde keys de objetos:
 *   eso abre la puerta a inyección SQL si el payload viene de fuera).
 * - Filtros dinámicos construidos solo desde valores validados por Zod (enums), y aun así
 *   pasados como replacements, no concatenados.
 * - `QueryTypes` explícito en cada query para tipado correcto.
 */

export interface SchemaVersionRow {
  _id: string;
  version_code: string;
  created_by_platform_user_id: string | null;
  created_at: Date;
  notes: string | null;
  is_active: boolean;
  parent_version_id: string | null;
}

export interface SchemaTableRow {
  _id: string;
  schema_version_id: string;
  table_name: string;
  table_type: 'transactional' | 'catalog' | 'audit' | 'operational';
  is_append_only: boolean;
  is_tenant_scoped: boolean;
  description: string | null;
  created_at: Date;
  is_deleted: boolean;
}

export interface SchemaColumnRow {
  _id: string;
  schema_table_id: string;
  column_name: string;
  column_type: string;
  is_nullable: boolean;
  is_immutable: boolean;
  is_pii: boolean;
  is_indexed: boolean;
  default_value: string | null;
  description: string | null;
  is_deleted: boolean;
}

export interface SchemaRelationshipRow {
  _id: string;
  schema_version_id: string;
  source_table_id: string;
  source_column_name: string;
  target_table_id: string;
  target_table_name: string | null;
  target_column_name: string;
  cascade_delete: boolean;
  is_immutable: boolean;
}

export type SchemaChangeApprovalStatus = 'pending' | 'approved' | 'rejected';
export type SchemaChangeResult = 'pending' | 'success' | 'failed' | 'rejected';

export interface SchemaChangeLogRow {
  _id: string;
  schema_version_id: string | null;
  change_type: string;
  affected_entity_id: string | null;
  affected_entity_type: string;
  change_payload: Record<string, unknown>;
  requester_platform_user_id: string;
  approval_status: SchemaChangeApprovalStatus;
  approved_by_platform_user_id: string | null;
  approved_at: Date | null;
  approval_notes: string | null;
  rolled_back: boolean;
  change_result: SchemaChangeResult | null;
  error_message: string | null;
  created_at: Date;
}

interface CountRow {
  count: string;
}

interface GroupedCountRow {
  schema_version_id: string;
  count: string;
}

export interface SchemaVersionCounts {
  tablesCount: number;
  columnsCount: number;
  relationshipsCount: number;
}

export interface CreateChangeLogEntryInput {
  changeType: string;
  affectedEntityType: string;
  changePayload: Record<string, unknown>;
  requesterPlatformUserId: string;
}

export interface ResolveChangeLogEntryInput {
  approvalStatus: Extract<SchemaChangeApprovalStatus, 'approved' | 'rejected'>;
  approvedByPlatformUserId: string;
  approvalNotes: string | null;
  changeResult: SchemaChangeResult;
  errorMessage: string | null;
}

@Injectable()
export class SchemaManagementRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  // =========================================================================
  // SCHEMA VERSIONS
  // =========================================================================

  async getSchemaVersion(versionId: string): Promise<SchemaVersionRow | null> {
    const rows = await this.sequelize.query<SchemaVersionRow>(
      `SELECT _id, version_code, created_by_platform_user_id, created_at, notes, is_active, parent_version_id
       FROM schema_versions
       WHERE _id = :versionId`,
      { type: QueryTypes.SELECT, replacements: { versionId } },
    );
    return rows[0] ?? null;
  }

  async listSchemaVersions(limit: number, offset: number, includeInactive: boolean): Promise<{ rows: SchemaVersionRow[]; total: number }> {
    const activeFilter = includeInactive ? '' : 'WHERE is_active = true';

    const rows = await this.sequelize.query<SchemaVersionRow>(
      `SELECT _id, version_code, created_by_platform_user_id, created_at, notes, is_active, parent_version_id
       FROM schema_versions
       ${activeFilter}
       ORDER BY created_at DESC, _id DESC
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: { limit, offset } },
    );

    const countRows = await this.sequelize.query<CountRow>(`SELECT COUNT(*)::text AS count FROM schema_versions ${activeFilter}`, {
      type: QueryTypes.SELECT,
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

  // =========================================================================
  // SCHEMA TABLES
  // =========================================================================

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
  ): Promise<{ rows: SchemaTableRow[]; total: number }> {
    // tableType proviene de un enum Zod ya validado; aun así va como replacement.
    const typeFilter = tableType ? 'AND table_type = :tableType' : '';

    const rows = await this.sequelize.query<SchemaTableRow>(
      `SELECT _id, schema_version_id, table_name, table_type, is_append_only,
              is_tenant_scoped, description, created_at, is_deleted
       FROM schema_tables
       WHERE schema_version_id = :versionId AND is_deleted = false ${typeFilter}
       ORDER BY table_name ASC
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: { versionId, tableType, limit, offset } },
    );

    const countRows = await this.sequelize.query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM schema_tables
       WHERE schema_version_id = :versionId AND is_deleted = false ${typeFilter}`,
      { type: QueryTypes.SELECT, replacements: { versionId, tableType } },
    );

    return { rows, total: Number(countRows[0]?.count ?? '0') };
  }

  // =========================================================================
  // SCHEMA COLUMNS
  // =========================================================================

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

  // =========================================================================
  // SCHEMA RELATIONSHIPS
  // =========================================================================

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

  // =========================================================================
  // SCHEMA CHANGE LOG (auditoría de propuestas DDL)
  // =========================================================================

  async createChangeLogEntry(input: CreateChangeLogEntryInput, transaction?: Transaction): Promise<SchemaChangeLogRow> {
    // Columnas EXPLÍCITAS: nunca se construyen desde keys del payload.
    const rows = await this.sequelize.query<SchemaChangeLogRow>(
      `INSERT INTO schema_change_log
         (change_type, affected_entity_type, change_payload,
          requester_platform_user_id, approval_status, change_result,
          rolled_back, created_at)
       VALUES
         (:changeType, :affectedEntityType, CAST(:changePayload AS JSONB),
          :requesterPlatformUserId, 'pending', 'pending',
          false, NOW())
       RETURNING _id, schema_version_id, change_type, affected_entity_id, affected_entity_type,
                 change_payload, requester_platform_user_id, approval_status,
                 approved_by_platform_user_id, approved_at, approval_notes,
                 rolled_back, change_result, error_message, created_at`,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements: {
          changeType: input.changeType,
          affectedEntityType: input.affectedEntityType,
          changePayload: JSON.stringify(input.changePayload),
          requesterPlatformUserId: input.requesterPlatformUserId,
        },
      },
    );
    const created = rows[0];
    if (!created) {
      throw new Error('Failed to insert schema_change_log entry');
    }
    return created;
  }

  async getChangeLogEntry(changeId: string): Promise<SchemaChangeLogRow | null> {
    const rows = await this.sequelize.query<SchemaChangeLogRow>(
      `SELECT _id, schema_version_id, change_type, affected_entity_id, affected_entity_type,
              change_payload, requester_platform_user_id, approval_status,
              approved_by_platform_user_id, approved_at, approval_notes,
              rolled_back, change_result, error_message, created_at
       FROM schema_change_log
       WHERE _id = :changeId`,
      { type: QueryTypes.SELECT, replacements: { changeId } },
    );
    return rows[0] ?? null;
  }

  /**
   * Lock pesimista para evitar doble aprobación concurrente del mismo cambio.
   * Debe usarse dentro de una transacción.
   */
  async getChangeLogEntryForUpdate(changeId: string, transaction: Transaction): Promise<SchemaChangeLogRow | null> {
    const rows = await this.sequelize.query<SchemaChangeLogRow>(
      `SELECT _id, schema_version_id, change_type, affected_entity_id, affected_entity_type,
              change_payload, requester_platform_user_id, approval_status,
              approved_by_platform_user_id, approved_at, approval_notes,
              rolled_back, change_result, error_message, created_at
       FROM schema_change_log
       WHERE _id = :changeId
       FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { changeId }, transaction },
    );
    return rows[0] ?? null;
  }

  async listChangeLog(
    approvalStatus: string | undefined,
    changeType: string | undefined,
    requesterUserId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ rows: SchemaChangeLogRow[]; total: number }> {
    const filters: string[] = [];
    if (approvalStatus) filters.push('approval_status = :approvalStatus');
    if (changeType) filters.push('change_type = :changeType');
    if (requesterUserId) filters.push('requester_platform_user_id = :requesterUserId');
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const replacements = { approvalStatus, changeType, requesterUserId, limit, offset };

    const rows = await this.sequelize.query<SchemaChangeLogRow>(
      `SELECT _id, schema_version_id, change_type, affected_entity_id, affected_entity_type,
              change_payload, requester_platform_user_id, approval_status,
              approved_by_platform_user_id, approved_at, approval_notes,
              rolled_back, change_result, error_message, created_at
       FROM schema_change_log
       ${whereClause}
       ORDER BY created_at DESC, _id DESC
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements },
    );

    const countRows = await this.sequelize.query<CountRow>(`SELECT COUNT(*)::text AS count FROM schema_change_log ${whereClause}`, {
      type: QueryTypes.SELECT,
      replacements,
    });

    return { rows, total: Number(countRows[0]?.count ?? '0') };
  }

  /**
   * Marca un cambio como aprobado o rechazado. Solo actualiza campos explícitos.
   * Devuelve la fila actualizada, o null si no existía.
   */
  async resolveChangeLogEntry(
    changeId: string,
    input: ResolveChangeLogEntryInput,
    transaction?: Transaction,
  ): Promise<SchemaChangeLogRow | null> {
    const rows = await this.sequelize.query<SchemaChangeLogRow>(
      `UPDATE schema_change_log
       SET approval_status = :approvalStatus,
           approved_by_platform_user_id = :approvedByPlatformUserId,
           approved_at = NOW(),
           approval_notes = :approvalNotes,
           change_result = :changeResult,
           error_message = :errorMessage
       WHERE _id = :changeId
       RETURNING _id, schema_version_id, change_type, affected_entity_id, affected_entity_type,
                 change_payload, requester_platform_user_id, approval_status,
                 approved_by_platform_user_id, approved_at, approval_notes,
                 rolled_back, change_result, error_message, created_at`,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements: {
          changeId,
          approvalStatus: input.approvalStatus,
          approvedByPlatformUserId: input.approvedByPlatformUserId,
          approvalNotes: input.approvalNotes,
          changeResult: input.changeResult,
          errorMessage: input.errorMessage,
        },
      },
    );
    return rows[0] ?? null;
  }

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  async withTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(callback);
  }
}
