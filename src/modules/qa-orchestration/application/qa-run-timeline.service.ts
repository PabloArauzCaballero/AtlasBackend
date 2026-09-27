/**
 * @file Servicio de aplicación: línea de tiempo de latencia y carga de una corrida QA.
 * @business Esta pieza responde «¿cuánta carga generó la corrida, cuánto tardó el backend y cuándo
 *   empezó a fallar?» en tramos de pocos segundos, para el gráfico del laboratorio.
 * @system acota por tenant con `findRun` (otro tenant = el mismo 404); la agregación es del
 *   repositorio, en SQL; aquí sólo se elige el tramo y se da forma a los números.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { QaRunQueryRepository } from '../infrastructure/qa-run-query.repository.js';
import {
  QaRunTimelineRepository,
  type TimelineBucketRow,
  type TimelineTotalsRow,
  type TimelineWindow,
} from '../infrastructure/qa-run-timeline.repository.js';
import { actorOf } from './qa-run-orchestrator.service.js';
import { qaError } from './qa-errors.js';

/** Tramos que el gráfico admite sin perder lectura cuando el tramo no se pide. */
export const QA_TIMELINE_TARGET_BUCKETS = 120;

export type QaTimelineBucket = {
  t: string;
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  personasActive: number;
};

export type QaTimeline = {
  runId: string;
  bucketSeconds: number;
  startedAt: string | null;
  buckets: QaTimelineBucket[];
  totals: { requests: number; errors: number; p50Ms: number | null; p95Ms: number | null; rps: number };
};

/** El tramo más corto (1–60 s) que deja la ventana en ≤ 120 tramos; más de 2 h satura en 60 s. */
export function defaultBucketSeconds(spanSeconds: number): number {
  return Math.min(60, Math.max(1, Math.ceil(spanSeconds / QA_TIMELINE_TARGET_BUCKETS)));
}

const count = (value: number | string | null | undefined): number => Number(value ?? 0) || 0;
const ms = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? null : Math.round(Number(value));

export function mapTimeline(
  window: TimelineWindow,
  rows: { buckets: TimelineBucketRow[]; totals: TimelineTotalsRow | null },
): Omit<QaTimeline, 'runId' | 'startedAt'> {
  const startMs = window.start.getTime();
  const spanSeconds = Math.max(1, (window.end.getTime() - startMs) / 1000);
  const requests = count(rows.totals?.requests);
  return {
    bucketSeconds: window.bucketSeconds,
    buckets: rows.buckets.map((row) => ({
      t: new Date(startMs + count(row.idx) * window.bucketSeconds * 1000).toISOString(),
      requests: count(row.requests),
      errors: count(row.errors),
      p50Ms: ms(row.p50),
      p95Ms: ms(row.p95),
      maxMs: ms(row.max_ms),
      personasActive: count(row.personas_active),
    })),
    totals: {
      requests,
      errors: count(rows.totals?.errors),
      p50Ms: ms(rows.totals?.p50),
      p95Ms: ms(rows.totals?.p95),
      rps: Math.round((requests / spanSeconds) * 100) / 100,
    },
  };
}

@Injectable()
export class QaRunTimelineService {
  constructor(
    private readonly query: QaRunQueryRepository,
    private readonly timelines: QaRunTimelineRepository,
  ) {}

  async timeline(user: AuthenticatedUser, runId: string, bucketSeconds?: number, now: Date = new Date()): Promise<QaTimeline> {
    const { tenantId } = actorOf(user);
    const run = await this.query.findRun(tenantId, runId);
    if (!run) throw new NotFoundException(qaError('QA_RUN_NOT_FOUND'));
    // Una corrida encolada aún no tiene tiempo que mostrar: tramos vacíos, no un eje inventado.
    if (!run.started_at) {
      return {
        runId,
        bucketSeconds: bucketSeconds ?? 1,
        startedAt: null,
        buckets: [],
        totals: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rps: 0 },
      };
    }
    const start = new Date(run.started_at);
    const finished = run.finished_at ? new Date(run.finished_at) : now;
    const end = finished.getTime() > start.getTime() ? finished : new Date(start.getTime() + 1000);
    const bucket = bucketSeconds ?? defaultBucketSeconds((end.getTime() - start.getTime()) / 1000);
    const window: TimelineWindow = { runId, start, end, bucketSeconds: bucket };
    const rows = await this.timelines.timeline(window);
    return { runId, startedAt: start.toISOString(), ...mapTimeline(window, rows) };
  }
}
