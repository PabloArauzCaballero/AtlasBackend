/**
 * @file Puerto de persistencia: feed unificado de auditoría (vista `audit_event_feed`) con cursor en base de datos.
 * @business Esta pieza aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
 * @system consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';

export type AuditFeedRow = {
  source_table: string;
  source_id: string;
  tenant_id: string;
  occurred_at: string;
  actor_type: string | null;
  event_type: string;
  target_type: string | null;
  target_id: string | null;
  payload_json: Record<string, unknown> | null;
};

@Injectable()
export class AuditFeedRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * ATLAS-P11-T10 (cierra la parte de `audit.repository.ts` que quedaba abierta en
   * `ATLAS-PEND-102` tras `ATLAS-P10`): variante por cursor real, empujado a la base de datos,
   * sobre las 8 fuentes de eventos de auditoría — lee de la vista `audit_event_feed` creada por
   * la migración `20260703035812-add-unified-audit-event-feed-view.ts` en vez de pedir
   * `offset + limit` filas de cada tabla y recortar en memoria (lo que hace
   * `findCustomerAuditEvents` arriba, que se mantiene sin cambios por compatibilidad).
   *
   * El cursor es una tupla `(occurred_at, source_table, source_id)` comparada como ROW en SQL
   * (`(occurred_at, source_table, source_id) < (:cursorOccurredAt, :cursorSourceTable,
   * :cursorSourceId)`), porque `source_id` por sí solo NO es único entre fuentes (cada tabla
   * origen tiene su propia secuencia de IDs) — `source_table` es parte necesaria de la clave de
   * paginación, no solo un campo informativo.
   *
   * Alcance: a diferencia de `findCustomerAuditEvents` (que solo cubre 5 fuentes), esta variante
   * cubre las 8 fuentes de la vista. El filtro por cliente replica la semántica de la vista
   * original: `data_change_log` no tiene un `target_type` fijo (usa el nombre de tabla real), así
   * que para esa fuente se filtra por la tabla del cliente y su `record_id` (el de otras tablas puede coincidir).
   */
  async findCustomerAuditEventsWithCursor(
    tenantId: string,
    customerId: string,
    query: { limit: number; cursor?: string },
  ): Promise<{ items: AuditFeedRow[]; nextCursor: string | null }> {
    const cursorKey = decodeAuditCursor(query.cursor);
    const limit = Math.min(query.limit, 100);

    const cursorClause = cursorKey
      ? `AND (occurred_at, source_table, source_id) < (:cursorOccurredAt, :cursorSourceTable, :cursorSourceId)`
      : '';

    const rows = await this.sequelize.query<AuditFeedRow>(
      `
      SELECT source_table, source_id, tenant_id, occurred_at, actor_type, event_type, target_type, target_id, payload_json
      FROM audit_event_feed
      WHERE tenant_id = :tenantId
        AND (
          (target_type = 'customer' AND target_id = :customerId)
          OR (source_table = 'data_change_log' AND source_id IS NOT NULL AND target_type IN (:customerTables) AND target_id = :customerId)
        )
        ${cursorClause}
      ORDER BY occurred_at DESC, source_table DESC, source_id DESC
      LIMIT :limitPlusOne;
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          tenantId,
          customerId,
          customerTables: ['customers', 'customer'],
          limitPlusOne: limit + 1,
          ...(cursorKey
            ? { cursorOccurredAt: cursorKey.occurredAt, cursorSourceTable: cursorKey.sourceTable, cursorSourceId: cursorKey.sourceId }
            : {}),
        },
      },
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeAuditCursor({ occurredAt: last.occurred_at, sourceTable: last.source_table, sourceId: last.source_id })
        : null;

    return { items, nextCursor };
  }
}
