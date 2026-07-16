import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, QueryTypes, WhereOperators } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  AuthEventModel,
  ConsentEventModel,
  CustomerActionLogModel,
  CustomerConsentModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { AuditQueryDto } from './audit.schemas.js';

type AuditEvent = {
  eventType: string;
  occurredAt: Date;
  actorType: string | null;
  summary: string;
  payload?: Record<string, unknown> | null;
};

type AuditFeedRow = {
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

function buildDateWhere(query: AuditQueryDto): WhereOperators<Date> | null {
  if (!query.from && !query.to) return null;
  const where: WhereOperators<Date> = {};
  if (query.from) where[Op.gte] = new Date(query.from);
  if (query.to) where[Op.lte] = new Date(query.to);
  return where;
}

/**
 * Repositorio de auditoría consolidada.
 *
 * La API paginada conserva `page`/`limit`; internamente cada fuente solicita suficientes filas
 * para cubrir la página combinada. Para lecturas profundas, usar la ruta por cursor respaldada
 * por la vista unificada de auditoría.
 */
@Injectable()
export class AuditRepository {
  constructor(
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(ConsentEventModel) private readonly consentEventModel: typeof ConsentEventModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
    @InjectModel(FraudCaseEventModel) private readonly fraudCaseEventModel: typeof FraudCaseEventModel,
    @InjectModel(CustomerConsentModel) private readonly customerConsentModel: typeof CustomerConsentModel,
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async findCustomerAuditEvents(tenantId: string, customerId: string, query: AuditQueryDto): Promise<AuditEvent[]> {
    const dateWhere = buildDateWhere(query);
    const pageLimit = Math.min(query.limit, 100);
    // Profundidad por fuente: suficiente para cubrir hasta el final de la página pedida. Con
    // MAX_DEPTH se evita que una página muy alta pida una cantidad de filas sin techo.
    const MAX_DEPTH = 1000;
    const depth = Math.min(query.page * pageLimit, MAX_DEPTH);
    const collections: AuditEvent[][] = [];

    if (query.eventType === 'all' || query.eventType === 'status') {
      const rows = await this.customerStatusEventModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { happenedAt: dateWhere } : {}) },
        limit: depth,
        order: [['happenedAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'status',
          occurredAt: row.happenedAt ?? row.createdAtValue,
          actorType: row.changedByType,
          summary: `Estado: ${row.previousStatus ?? 'none'} -> ${row.newStatus}`,
          payload: { reasonCode: row.reasonCode },
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'customer_action') {
      const rows = await this.customerActionLogModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'customer_action',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: 'customer',
          summary: row.eventName ?? 'customer_action',
          payload: row.actionPayloadJson,
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'auth') {
      const rows = await this.authEventModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'auth',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: 'customer',
          summary: row.eventType ?? 'auth_event',
          payload: { loginSuccessful: row.loginSuccessful, failureReasonCode: row.failureReasonCode },
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'data_change') {
      const rows = await this.dataChangeLogModel.findAll({
        where: { tenantId, recordId: customerId, ...(dateWhere ? { changedAt: dateWhere } : {}) },
        limit: depth,
        order: [['changedAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'data_change',
          occurredAt: row.changedAt ?? row.createdAtValue,
          actorType: row.changedByType,
          summary: `${row.tableName}:${row.changeType}`,
          payload: { changeReason: row.changeReason },
        })),
      );
    }
    if (query.eventType === 'all') {
      const rows = await this.operationalAuditLogModel.findAll({
        where: { tenantId, targetType: 'customer', targetId: customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'operational_audit',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: row.actorType,
          summary: row.actionCode ?? 'audit',
          payload: row.payloadJson,
        })),
      );
    }
    // Algunas fuentes no tienen `customerId` directo; primero se resuelven los ids del padre.
    if (query.eventType === 'all' || query.eventType === 'consent') {
      const consents = await this.customerConsentModel.findAll({
        where: { tenantId, customerId },
        attributes: ['id'],
      } as FindOptions);
      const consentIds = consents.map((c) => c.id);
      if (consentIds.length > 0) {
        const rows = await this.consentEventModel.findAll({
          where: { tenantId, customerConsentId: { [Op.in]: consentIds }, ...(dateWhere ? { happenedAt: dateWhere } : {}) },
          limit: depth,
          order: [['happenedAt', 'DESC']],
        } as FindOptions);
        collections.push(
          rows.map((row) => ({
            eventType: 'consent',
            occurredAt: row.happenedAt ?? row.createdAtValue,
            actorType: row.triggeredByType,
            summary: row.eventType ?? 'consent_event',
            payload: { notes: row.notes },
          })),
        );
      }
    }
    if (query.eventType === 'all' || query.eventType === 'manual_review') {
      const cases = await this.manualReviewCaseModel.findAll({ where: { tenantId, customerId }, attributes: ['id'] } as FindOptions);
      const caseIds = cases.map((c) => c.id);
      if (caseIds.length > 0) {
        const rows = await this.manualReviewEventModel.findAll({
          where: { tenantId, manualReviewCaseId: { [Op.in]: caseIds }, ...(dateWhere ? { happenedAt: dateWhere } : {}) },
          limit: depth,
          order: [['happenedAt', 'DESC']],
        } as FindOptions);
        collections.push(
          rows.map((row) => ({
            eventType: 'manual_review',
            occurredAt: row.happenedAt ?? row.createdAtValue,
            actorType: row.actorType,
            summary: row.eventType ?? 'manual_review_event',
            payload: row.payloadJson,
          })),
        );
      }
    }
    if (query.eventType === 'all' || query.eventType === 'fraud') {
      const cases = await this.fraudCaseModel.findAll({ where: { tenantId, customerId }, attributes: ['id'] } as FindOptions);
      const caseIds = cases.map((c) => c.id);
      if (caseIds.length > 0) {
        const rows = await this.fraudCaseEventModel.findAll({
          where: { tenantId, fraudCaseId: { [Op.in]: caseIds }, ...(dateWhere ? { happenedAt: dateWhere } : {}) },
          limit: depth,
          order: [['happenedAt', 'DESC']],
        } as FindOptions);
        collections.push(
          rows.map((row) => ({
            eventType: 'fraud',
            occurredAt: row.happenedAt ?? row.createdAtValue,
            actorType: row.actorType,
            summary: row.eventType ?? 'fraud_case_event',
            payload: row.payloadJson,
          })),
        );
      }
    }
    return collections.flat().sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

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
   * que para esa fuente se filtra por `source_id = customerId` directamente en vez de por
   * `target_type = 'customer'`.
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
          OR (source_table = 'data_change_log' AND source_id IS NOT NULL AND target_id = :customerId)
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

export type AuditCursorKey = { occurredAt: string; sourceTable: string; sourceId: string };

export function encodeAuditCursor(key: AuditCursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor: string | undefined): AuditCursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<AuditCursorKey>;
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.sourceTable !== 'string' || typeof parsed.sourceId !== 'string') return null;
    return { occurredAt: parsed.occurredAt, sourceTable: parsed.sourceTable, sourceId: parsed.sourceId };
  } catch {
    return null;
  }
}
