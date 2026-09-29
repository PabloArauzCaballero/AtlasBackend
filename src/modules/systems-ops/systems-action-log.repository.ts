/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
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
  /** Cuántas rutas distintas hubo en la ventana, antes de buscar, filtrar y cortar. */
  routes_total: string;
  /** Cuántas cumplen el buscador y el método: es el `total` que pagina la tabla. */
  routes_matching?: string;
  /**
   * `false` en la fila que sólo trae los totales de la ventana: si el buscador no encuentra nada,
   * la ventana no se queda sin resumen. Ausente equivale a `true` (versiones anteriores de la consulta).
   */
  route_present?: boolean;
};

/** Qué rutas y qué página de ellas. Sin nada, las `TRAFFIC_ROUTES_LIMIT` con más peticiones. */
export type TrafficRoutesQuery = { q?: string; method?: string; limit?: number; offset?: number };

/** Rutas que devuelve el informe de tráfico, ordenadas por volumen. */
export const TRAFFIC_ROUTES_LIMIT = 50;

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

  /**
   * Los valores DISTINTOS de una columna de la bitácora, para poblar un filtro.
   *
   * Se consultan de la tabla y no de una constante porque no existe lista
   * canónica: los módulos y los tipos de actor los escribe quien instrumenta
   * cada endpoint. Una lista a mano envejece en silencio —se añade un módulo,
   * nadie toca la constante— y el filtro deja de poder encontrarlo, que es un
   * fallo invisible: la pantalla se ve completa.
   *
   * La columna NO viene del cliente: se elige de un mapa cerrado en el llamador,
   * porque interpolar un nombre de columna que llega de fuera es una inyección
   * SQL con otro nombre.
   */
  async listDistinctValues(column: 'module' | 'actor_type', tenantId: string | null): Promise<string[]> {
    const rows = await this.sequelize.query<{ valor: string | null }>(
      `SELECT DISTINCT ${column === 'module' ? 'module' : 'actor_type'} AS valor
         FROM system_action_logs
        WHERE (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS bigint))
          AND ${column === 'module' ? 'module' : 'actor_type'} IS NOT NULL
        ORDER BY valor ASC
        LIMIT 200`,
      { replacements: { tenantId }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.valor).filter((valor): valor is string => valor !== null && valor.trim() !== '');
  }

  findActionLogsByRequest(requestId: string, tenantId: string | null): Promise<SystemActionLogModel[]> {
    return this.actionLogModel.findAll({
      where: { requestId, ...(tenantId === null ? {} : { tenantId }) },
      order: [['occurredAt', 'DESC']],
    } as FindOptions);
  }

  getTrafficLatencyByRoute(fromDate: Date, tenantId: string | null, routes: TrafficRoutesQuery = {}): Promise<TrafficLatencyRow[]> {
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
      ), por_ruta AS (
        SELECT route_template,
               method,
               COUNT(*) AS requests,
               AVG(duration_ms) AS avg_latency_ms,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms,
               COUNT(*) FILTER (WHERE response_status_code >= 500) AS error_count,
               MAX(occurred_at) AS last_seen_at
          FROM filtered
         GROUP BY route_template, method
      ), coincidentes AS (
        -- Buscar y filtrar sólo acota la tabla: los totales de arriba son de toda la ventana.
        SELECT *, COUNT(*) OVER () AS matching
          FROM por_ruta
         WHERE (:method IS NULL OR method = :method)
           AND (:q IS NULL OR route_template ILIKE :q OR method ILIKE :q)
         ORDER BY requests DESC, route_template ASC NULLS LAST, method ASC
         LIMIT :routesLimit OFFSET :routesOffset
      )
      SELECT
        c.route_template,
        c.method,
        c.requests::text AS total_requests,
        c.avg_latency_ms::text AS avg_latency_ms,
        c.p95_latency_ms::text AS p95_latency_ms,
        c.error_count::text AS error_count,
        c.last_seen_at,
        (c.requests IS NOT NULL) AS route_present,
        overall.total_requests AS overall_total_requests,
        overall.avg_latency_ms AS overall_avg_latency_ms,
        overall.p95_latency_ms AS overall_p95_latency_ms,
        overall.error_count AS overall_error_count,
        (SELECT COUNT(*) FROM por_ruta)::text AS routes_total,
        COALESCE(c.matching, 0)::text AS routes_matching
      FROM overall LEFT JOIN coincidentes c ON TRUE
      ORDER BY c.requests DESC NULLS LAST, c.route_template ASC NULLS LAST, c.method ASC;
      `,
      {
        replacements: {
          fromDate,
          tenantId,
          q: routes.q ? containsLikePattern(routes.q) : null,
          method: routes.method ?? null,
          routesLimit: routes.limit ?? TRAFFIC_ROUTES_LIMIT,
          routesOffset: routes.offset ?? 0,
        },
        type: QueryTypes.SELECT,
      },
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
