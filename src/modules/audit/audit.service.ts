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
}
