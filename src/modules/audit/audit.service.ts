import { Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { AuditRepository } from './audit.repository.js';
import { AuditCustomerParamsDto, AuditQueryDto } from './audit.schemas.js';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async getCustomerAudit(tenantId: string, params: AuditCustomerParamsDto, query: AuditQueryDto) {
    const rows = await this.repository.findCustomerAuditEvents(tenantId, params.customerId, query);
    const start = (query.page - 1) * query.limit;
    const pageRows = rows.slice(start, start + query.limit);
    return {
      events: pageRows.map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        actorType: event.actorType,
        summary: event.summary,
      })),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, rows.length),
    };
  }

  /**
   * ATLAS-P11-T10: variante por cursor real de `getCustomerAudit`, leyendo de la vista
   * `audit_event_feed` (cubre 8 fuentes en vez de las 5 de `findCustomerAuditEvents`). Pensada
   * para reemplazar gradualmente a `getCustomerAudit` en el panel de operaciones a medida que el
   * volumen de auditoría crezca.
   */
  async getCustomerAuditFeed(tenantId: string, customerId: string, query: { limit: number; cursor?: string }) {
    const result = await this.repository.findCustomerAuditEventsWithCursor(tenantId, customerId, query);
    return {
      events: result.items.map((row) => ({
        sourceTable: row.source_table,
        eventType: row.event_type,
        occurredAt: new Date(row.occurred_at).toISOString(),
        actorType: row.actor_type,
        targetType: row.target_type,
        targetId: row.target_id,
      })),
      nextCursor: result.nextCursor,
    };
  }
}
