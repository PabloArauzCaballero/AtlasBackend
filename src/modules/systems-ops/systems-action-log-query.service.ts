import { Injectable } from '@nestjs/common';
import { mapActionLog } from './systems-ops.mapper.js';
import { SystemsActionLogQueryDto } from './systems-ops.schemas.js';
import { SystemsActionLogRepository } from './systems-action-log.repository.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { systemsTenantScope } from './systems-tenant-scope.util.js';

@Injectable()
export class SystemsActionLogQueryService {
  constructor(private readonly actionLogRepository: SystemsActionLogRepository) {}

  async listActionLogs(query: SystemsActionLogQueryDto, user: AuthenticatedUser) {
    const result = await this.actionLogRepository.listActionLogs(query, systemsTenantScope(user));
    return { items: result.rows.map(mapActionLog), meta: result.meta };
  }

  async getActionLogsByRequest(requestId: string, user: AuthenticatedUser) {
    const rows = await this.actionLogRepository.findActionLogsByRequest(requestId, systemsTenantScope(user));
    return { items: rows.map(mapActionLog) };
  }

  async getTrafficLatencyReport(windowHours: number, user: AuthenticatedUser) {
    const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const rows = await this.actionLogRepository.getTrafficLatencyByRoute(fromDate, systemsTenantScope(user));
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
    const overall = rows[0];
    const totalRequests = Number(overall?.overall_total_requests ?? 0);
    const totalErrors = Number(overall?.overall_error_count ?? 0);
    return {
      windowHours,
      summary: {
        totalRequests,
        avgLatencyMs: Math.round(Number(overall?.overall_avg_latency_ms ?? 0)),
        p95LatencyMs: Math.round(Number(overall?.overall_p95_latency_ms ?? 0)),
        serverErrorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      },
      routes,
    };
  }

  async getTrafficLatencyTimeseries(windowHours: number, user: AuthenticatedUser) {
    const bucketMinutes = bucketMinutesForWindow(windowHours);
    const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const rows = await this.actionLogRepository.getTrafficLatencyTimeseries(fromDate, bucketMinutes, systemsTenantScope(user));
    const byBucket = new Map(rows.map((row) => [new Date(row.bucket_start).getTime(), row]));

    // Se rellenan los buckets sin tráfico con ceros para que el gráfico
    // muestre huecos reales en vez de saltar de un punto con datos al
    // siguiente (lo cual distorsionaría la lectura de la serie de tiempo).
    const bucketMs = bucketMinutes * 60 * 1000;
    const startMs = Math.floor(fromDate.getTime() / bucketMs) * bucketMs;
    const endMs = Math.floor(Date.now() / bucketMs) * bucketMs;
    const buckets: {
      bucketStart: string;
      totalRequests: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      errorRate: number;
    }[] = [];
    for (let ms = startMs; ms <= endMs; ms += bucketMs) {
      const row = byBucket.get(ms);
      const totalRequests = row ? Number(row.total_requests) : 0;
      const errorCount = row ? Number(row.error_count) : 0;
      buckets.push({
        bucketStart: new Date(ms).toISOString(),
        totalRequests,
        avgLatencyMs: row?.avg_latency_ms ? Math.round(Number(row.avg_latency_ms)) : 0,
        p95LatencyMs: row?.p95_latency_ms ? Math.round(Number(row.p95_latency_ms)) : 0,
        errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
      });
    }

    return { windowHours, bucketMinutes, buckets };
  }
}

function bucketMinutesForWindow(windowHours: number): number {
  if (windowHours <= 2) return 5;
  if (windowHours <= 6) return 15;
  if (windowHours <= 24) return 30;
  return 120;
}
