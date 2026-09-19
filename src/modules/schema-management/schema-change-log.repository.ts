/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system registra cada propuesta de cambio de esquema y su resolución, con lock pesimista.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { CreateChangeLogEntryInput, ResolveChangeLogEntryInput, SchemaChangeLogRow } from './schema-management.repository.js';

interface CountRow {
  count: string;
}

/**
 * La AUDITORÍA de los cambios de esquema, separada del catálogo que describen.
 *
 * Son dos responsabilidades distintas que compartían archivo: una lee el inventario (versiones,
 * tablas, columnas, relaciones) y la otra registra quién propuso qué y quién lo resolvió, con su
 * `SELECT … FOR UPDATE` para que dos aprobaciones simultáneas no ejecuten el cambio dos veces.
 * El archivo común ya arrastraba deuda de tamaño congelada y esta era la costura natural.
 */
@Injectable()
export class SchemaChangeLogRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

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

  async withTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(callback);
  }
}
