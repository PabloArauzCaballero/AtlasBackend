import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemActionLogModel } from '../../database/models/index.js';
import { SystemsActionLogQueryDto } from './systems-ops.schemas.js';
import { buildActionLogWhere } from './systems-repository-where.util.js';

export type TrafficLatencyRow = {
  route_template: string | null;
  method: string;
  total_requests: string;
  avg_latency_ms: string | null;
  p95_latency_ms: string | null;
  error_count: string;
  last_seen_at: Date;
  overall_total_requests: string;
  overall_avg_latency_ms: string | null;
  overall_p95_latency_ms: string | null;
  overall_error_count: string;
};

export type TrafficLatencyBucketRow = {
  bucket_start: Date;
  total_requests: string;
  avg_latency_ms: string | null;
  p95_latency_ms: string | null;
  error_count: string;
};

@Injectable()
export class SystemsActionLogRepository {
  constructor(
    @InjectModel(SystemActionLogModel) private readonly actionLogModel: typeof SystemActionLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listActionLogs(query: SystemsActionLogQueryDto, tenantId: string | null) {
    const result = await this.actionLogModel.findAndCountAll({
      where: { ...buildActionLogWhere(query), ...(tenantId === null ? {} : { tenantId }) },
      order: [['occurredAt', 'DESC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findActionLogsByRequest(requestId: string, tenantId: string | null): Promise<SystemActionLogModel[]> {
    return this.actionLogModel.findAll({
      where: { requestId, ...(tenantId === null ? {} : { tenantId }) },
      order: [['occurredAt', 'DESC']],
    } as FindOptions);
  }

  getTrafficLatencyByRoute(fromDate: Date, tenantId: string | null): Promise<TrafficLatencyRow[]> {
    return this.sequelize.query<TrafficLatencyRow>(
      `
      WITH filtered AS (
        SELECT * FROM system_action_logs
         WHERE occurred_at >= :fromDate AND duration_ms IS NOT NULL
           AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS bigint))
      ), overall AS (
        SELECT COUNT(*)::text AS total_requests,
               AVG(duration_ms)::text AS avg_latency_ms,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_latency_ms,
               COUNT(*) FILTER (WHERE response_status_code >= 500)::text AS error_count
          FROM filtered
      )
      SELECT
        route_template,
        method,
        COUNT(*)::text AS total_requests,
        AVG(duration_ms)::text AS avg_latency_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_latency_ms,
        COUNT(*) FILTER (WHERE response_status_code >= 500)::text AS error_count,
        MAX(occurred_at) AS last_seen_at,
        overall.total_requests AS overall_total_requests,
        overall.avg_latency_ms AS overall_avg_latency_ms,
        overall.p95_latency_ms AS overall_p95_latency_ms,
        overall.error_count AS overall_error_count
      FROM filtered CROSS JOIN overall
      GROUP BY route_template, method, overall.total_requests, overall.avg_latency_ms,
               overall.p95_latency_ms, overall.error_count
      ORDER BY COUNT(*) DESC
      LIMIT 50;
      `,
      { replacements: { fromDate, tenantId }, type: QueryTypes.SELECT },
    );
  }

  // Agrupa por intervalos fijos de `bucketMinutes` usando floor-division sobre
  // epoch en vez de date_trunc, porque date_trunc solo soporta unidades
  // calendario (minute/hour/day) y no intervalos arbitrarios como 15 o 90 min.
  getTrafficLatencyTimeseries(fromDate: Date, bucketMinutes: number, tenantId: string | null): Promise<TrafficLatencyBucketRow[]> {
    return this.sequelize.query<TrafficLatencyBucketRow>(
      `
      SELECT
        to_timestamp(floor(extract(epoch FROM occurred_at) / :bucketSeconds) * :bucketSeconds) AS bucket_start,
        COUNT(*)::text AS total_requests,
        AVG(duration_ms)::text AS avg_latency_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_latency_ms,
        COUNT(*) FILTER (WHERE response_status_code >= 500)::text AS error_count
      FROM system_action_logs
      WHERE occurred_at >= :fromDate AND duration_ms IS NOT NULL
        AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS bigint))
      GROUP BY bucket_start
      ORDER BY bucket_start ASC;
      `,
      { replacements: { fromDate, bucketSeconds: bucketMinutes * 60, tenantId }, type: QueryTypes.SELECT },
    );
  }
}
