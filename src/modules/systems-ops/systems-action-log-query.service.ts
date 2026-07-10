import { Injectable } from '@nestjs/common';
import { mapActionLog } from './systems-ops.mapper.js';
import { SystemsActionLogQueryDto } from './systems-ops.schemas.js';
import { SystemsActionLogRepository } from './systems-action-log.repository.js';

@Injectable()
export class SystemsActionLogQueryService {
  constructor(private readonly actionLogRepository: SystemsActionLogRepository) {}

  async listActionLogs(query: SystemsActionLogQueryDto) {
    const result = await this.actionLogRepository.listActionLogs(query);
    return { items: result.rows.map(mapActionLog), meta: result.meta };
  }

  async getActionLogsByRequest(requestId: string) {
    const rows = await this.actionLogRepository.findActionLogsByRequest(requestId);
    return { items: rows.map(mapActionLog) };
  }

  async getTrafficLatencyReport(windowHours: number) {
    const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const rows = await this.actionLogRepository.getTrafficLatencyByRoute(fromDate);
    const routes = rows.map((row) => {
      const totalRequests = Number(row.total_requests);
      const errorCount = Number(row.error_count);
      return {
        routeTemplate: row.route_template,
        method: row.method,
        totalRequests,
        avgLatencyMs: row.avg_latency_ms ? Math.round(Number(row.avg_latency_ms)) : null,
        p95LatencyMs: row.p95_latency_ms ? Math.round(Number(row.p95_latency_ms)) : null,
        errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
        lastSeenAt: row.last_seen_at,
      };
    });
    const totalRequests = routes.reduce((sum, route) => sum + route.totalRequests, 0);
    const weightedAvg = totalRequests > 0
      ? routes.reduce((sum, route) => sum + (route.avgLatencyMs ?? 0) * route.totalRequests, 0) / totalRequests
      : 0;
    return {
      windowHours,
      summary: {
        totalRequests,
        avgLatencyMs: Math.round(weightedAvg),
        p95LatencyMs: routes.length ? Math.max(...routes.map((route) => route.p95LatencyMs ?? 0)) : 0,
        errorRate: totalRequests > 0 ? routes.reduce((sum, route) => sum + route.errorRate * route.totalRequests, 0) / totalRequests : 0,
      },
      routes,
    };
  }
}
