/**
 * @file Repositorio de persistencia: línea de tiempo de latencia y carga de una corrida QA.
 * @business Esta pieza alimenta el gráfico del laboratorio: cuántas peticiones terminaron en cada
 *   tramo, cuántas fallaron, cómo se repartió la latencia y cuántas personas estaban en vuelo.
 * @system agregación EN SQL sobre `qa_step_runs.attempts_json` (un elemento por intento) y
 *   `qa_persona_runs`; nunca se cargan miles de pasos al proceso para contarlos.
 *
 * Criterios, iguales en tramos y totales:
 * - Un intento cuenta en el tramo donde TERMINÓ su paso (`finished_at`): el intento no guarda hora
 *   propia. Los pasos sin terminar (RUNNING) no cuentan todavía.
 * - Error = intento sin código HTTP (transporte caído), código ≥ 500, o paso FAILED.
 * - La latencia sale de `latencyMs` de cada intento; uno sin número no entra en los percentiles.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

const S = atlasSchemaFor('qa_runs');

/** Tope de tramos por respuesta: una corrida muy larga con tramo corto no devuelve un millón de filas. */
export const QA_TIMELINE_MAX_BUCKETS = 1440;

export type TimelineBucketRow = {
  idx: number | string;
  requests: number | string;
  errors: number | string;
  p50: number | string | null;
  p95: number | string | null;
  max_ms: number | string | null;
  personas_active: number | string;
};

export type TimelineTotalsRow = {
  requests: number | string;
  errors: number | string;
  p50: number | string | null;
  p95: number | string | null;
};

export type TimelineWindow = { runId: string; start: Date; end: Date; bucketSeconds: number };

/**
 * Intentos expandidos con su tramo. `attempts_json` no-array se trata como vacío, y el `status` se
 * castea sólo si es número (un `CASE`, porque SQL no garantiza cortocircuito en un `OR`).
 */
const ATTEMPTS_CTE = `attempts AS (
    SELECT LEAST(GREATEST(FLOOR(EXTRACT(EPOCH FROM (s.finished_at - $start::timestamptz)) / $bucket::int)::int, 0), $lastIdx::int) AS idx,
           CASE WHEN jsonb_typeof(a->'latencyMs') = 'number' THEN (a->>'latencyMs')::numeric END AS latency,
           CASE
             WHEN s.status = 'FAILED' THEN true
             WHEN jsonb_typeof(a->'status') <> 'number' THEN true
             ELSE (a->>'status')::numeric >= 500
           END AS is_error
      FROM ${S}.qa_step_runs s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.attempts_json) = 'array' THEN s.attempts_json ELSE '[]'::jsonb END
      ) a
     WHERE s.run_id = $runId AND s.finished_at IS NOT NULL
  )`;

export const TIMELINE_BUCKETS_SQL = `WITH buckets AS (
    SELECT g.idx,
           $start::timestamptz + make_interval(secs => g.idx * $bucket::int) AS b_start,
           $start::timestamptz + make_interval(secs => (g.idx + 1) * $bucket::int) AS b_end
      FROM generate_series(0, $lastIdx::int) AS g(idx)
  ),
  ${ATTEMPTS_CTE},
  per_bucket AS (
    SELECT idx,
           COUNT(*) AS requests,
           COUNT(*) FILTER (WHERE is_error) AS errors,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency) AS p95,
           MAX(latency) AS max_ms
      FROM attempts GROUP BY idx
  )
  SELECT b.idx,
         COALESCE(pb.requests, 0)::int AS requests,
         COALESCE(pb.errors, 0)::int AS errors,
         pb.p50, pb.p95, pb.max_ms,
         (SELECT COUNT(*)::int FROM ${S}.qa_persona_runs p
           WHERE p.run_id = $runId AND p.started_at IS NOT NULL AND p.started_at <= b.b_end
             AND (p.finished_at IS NULL OR p.finished_at >= b.b_start)) AS personas_active
    FROM buckets b LEFT JOIN per_bucket pb ON pb.idx = b.idx
   ORDER BY b.idx;`;

export const TIMELINE_TOTALS_SQL = `WITH ${ATTEMPTS_CTE}
  SELECT COUNT(*)::int AS requests,
         COUNT(*) FILTER (WHERE is_error)::int AS errors,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency) AS p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency) AS p95
    FROM attempts;`;

/** Índice del último tramo de la ventana, acotado a `QA_TIMELINE_MAX_BUCKETS`. */
export function lastBucketIndex(window: Pick<TimelineWindow, 'start' | 'end' | 'bucketSeconds'>): number {
  const spanSeconds = Math.max(0, (window.end.getTime() - window.start.getTime()) / 1000);
  return Math.min(QA_TIMELINE_MAX_BUCKETS - 1, Math.max(0, Math.ceil(spanSeconds / window.bucketSeconds) - 1));
}

@Injectable()
export class QaRunTimelineRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /** Tramos y totales de la ventana. La corrida ya viene autorizada por tenant desde el servicio. */
  async timeline(window: TimelineWindow): Promise<{ buckets: TimelineBucketRow[]; totals: TimelineTotalsRow | null }> {
    const bind = { runId: window.runId, start: window.start, bucket: window.bucketSeconds, lastIdx: lastBucketIndex(window) };
    const [buckets, totals] = await Promise.all([
      this.sequelize.query<TimelineBucketRow>(TIMELINE_BUCKETS_SQL, { type: QueryTypes.SELECT, bind }),
      this.sequelize.query<TimelineTotalsRow>(TIMELINE_TOTALS_SQL, { type: QueryTypes.SELECT, bind }),
    ]);
    return { buckets, totals: totals[0] ?? null };
  }
}
