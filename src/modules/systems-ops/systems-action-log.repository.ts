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
};

@Injectable()
export class SystemsActionLogRepository {
  constructor(
    @InjectModel(SystemActionLogModel) private readonly actionLogModel: typeof SystemActionLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listActionLogs(query: SystemsActionLogQueryDto) {
    const result = await this.actionLogModel.findAndCountAll({
      where: buildActionLogWhere(query),
      order: [['occurredAt', 'DESC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findActionLogsByRequest(requestId: string): Promise<SystemActionLogModel[]> {
    return this.actionLogModel.findAll({ where: { requestId }, order: [['occurredAt', 'DESC']] } as FindOptions);
  }

  getTrafficLatencyByRoute(fromDate: Date): Promise<TrafficLatencyRow[]> {
    return this.sequelize.query<TrafficLatencyRow>(
      `
      SELECT
        route_template,
        method,
        COUNT(*)::text AS total_requests,
        AVG(duration_ms)::text AS avg_latency_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_latency_ms,
        COUNT(*) FILTER (WHERE response_status_code >= 500)::text AS error_count,
        MAX(occurred_at) AS last_seen_at
      FROM system_action_logs
      WHERE occurred_at >= :fromDate AND duration_ms IS NOT NULL
      GROUP BY route_template, method
      ORDER BY total_requests DESC
      LIMIT 50;
      `,
      { replacements: { fromDate }, type: QueryTypes.SELECT },
    );
  }
}
