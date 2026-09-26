import { HttpException } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types';
import {
  defaultBucketSeconds,
  mapTimeline,
  QaRunTimelineService,
} from '../../../src/modules/qa-orchestration/application/qa-run-timeline.service';
import type { QaRunQueryRepository, RunRow } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';
import {
  lastBucketIndex,
  QA_TIMELINE_MAX_BUCKETS,
  QaRunTimelineRepository,
  TIMELINE_BUCKETS_SQL,
  TIMELINE_TOTALS_SQL,
} from '../../../src/modules/qa-orchestration/infrastructure/qa-run-timeline.repository';
import { qaTimelineQuerySchema } from '../../../src/modules/qa-orchestration/qa-orchestration.schemas';

const user: AuthenticatedUser = { sub: 's', tenantId: '7', internalUserId: '11', role: 'SUPER_ADMIN' as AuthenticatedUser['role'] };
const START = new Date('2026-09-24T10:00:00Z');

const run = (overrides: Partial<RunRow> = {}) =>
  ({ _id: '42', _tenant_id: '7', started_at: START, finished_at: new Date('2026-09-24T10:01:00Z'), ...overrides }) as RunRow;

function build(row: RunRow | null) {
  const query = { findRun: jest.fn(async () => row) };
  const timelines = {
    timeline: jest.fn(async () => ({
      buckets: [
        { idx: '0', requests: '3', errors: '1', p50: 200, p95: '290.4', max_ms: '300', personas_active: '2' },
        { idx: 1, requests: 0, errors: 0, p50: null, p95: null, max_ms: null, personas_active: 1 },
      ],
      totals: { requests: '3', errors: '1', p50: 200, p95: 290.4 },
    })),
  };
  const service = new QaRunTimelineService(query as unknown as QaRunQueryRepository, timelines as unknown as QaRunTimelineRepository);
  return { service, query, timelines };
}

describe('línea de tiempo de una corrida QA: servicio', () => {
  it('otro tenant (o un id inexistente) recibe QA_RUN_NOT_FOUND sin consultar la agregación', async () => {
    const { service, query, timelines } = build(null);
    await expect(service.timeline(user, '42')).rejects.toBeInstanceOf(HttpException);
    expect(query.findRun).toHaveBeenCalledWith('7', '42');
    expect(timelines.timeline).not.toHaveBeenCalled();
  });

  it('una corrida sin arrancar devuelve tramos vacíos y startedAt null, no un eje inventado', async () => {
    const { service, timelines } = build(run({ started_at: null, finished_at: null }));
    const result = await service.timeline(user, '42');
    expect(result).toEqual({
      runId: '42',
      bucketSeconds: 1,
      startedAt: null,
      buckets: [],
      totals: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rps: 0 },
    });
    expect(timelines.timeline).not.toHaveBeenCalled();
  });

  it('corrida terminada: ventana hasta finished_at, tramo por defecto y números ya convertidos', async () => {
    const { service, timelines } = build(run());
    const result = await service.timeline(user, '42');
    expect(timelines.timeline).toHaveBeenCalledWith({
      runId: '42',
      start: START,
      end: new Date('2026-09-24T10:01:00Z'),
      bucketSeconds: 1,
    });
    expect(result.startedAt).toBe('2026-09-24T10:00:00.000Z');
    expect(result.buckets[0]).toEqual({
      t: '2026-09-24T10:00:00.000Z',
      requests: 3,
      errors: 1,
      p50Ms: 200,
      p95Ms: 290,
      maxMs: 300,
      personasActive: 2,
    });
    expect(result.buckets[1]).toMatchObject({ t: '2026-09-24T10:00:01.000Z', p50Ms: null, maxMs: null, personasActive: 1 });
    expect(result.totals).toEqual({ requests: 3, errors: 1, p50Ms: 200, p95Ms: 290, rps: 0.05 });
  });

  it('corrida en curso: la ventana llega hasta ahora y respeta el tramo pedido', async () => {
    const { service, timelines } = build(run({ finished_at: null }));
    const now = new Date('2026-09-24T10:10:00Z');
    const result = await service.timeline(user, '42', 10, now);
    expect(timelines.timeline).toHaveBeenCalledWith({ runId: '42', start: START, end: now, bucketSeconds: 10 });
    expect(result.bucketSeconds).toBe(10);
    expect(result.buckets[1].t).toBe('2026-09-24T10:00:10.000Z');
  });

  it('un reloj por detrás del arranque no produce una ventana negativa', async () => {
    const { service, timelines } = build(run({ finished_at: null }));
    await service.timeline(user, '42', undefined, new Date('2026-09-24T09:59:00Z'));
    expect(timelines.timeline).toHaveBeenCalledWith(expect.objectContaining({ end: new Date('2026-09-24T10:00:01Z'), bucketSeconds: 1 }));
  });
});

describe('línea de tiempo: tramo y forma', () => {
  it('el tramo por defecto deja ≤ 120 tramos entre 1 y 60 s', () => {
    expect(defaultBucketSeconds(0)).toBe(1);
    expect(defaultBucketSeconds(60)).toBe(1);
    expect(defaultBucketSeconds(121)).toBe(2);
    expect(defaultBucketSeconds(600)).toBe(5);
    expect(defaultBucketSeconds(3600)).toBe(30);
    expect(defaultBucketSeconds(100_000)).toBe(60);
  });

  it('sin fila de totales todo es cero y los percentiles son null', () => {
    const window = { runId: '1', start: START, end: new Date('2026-09-24T10:00:10Z'), bucketSeconds: 5 };
    expect(mapTimeline(window, { buckets: [], totals: null })).toEqual({
      bucketSeconds: 5,
      buckets: [],
      totals: { requests: 0, errors: 0, p50Ms: null, p95Ms: null, rps: 0 },
    });
  });

  it('el esquema acepta 1–60 (texto de la query incluido) y rechaza lo demás', () => {
    expect(qaTimelineQuerySchema.parse({ bucketSeconds: '5' })).toEqual({ bucketSeconds: 5 });
    expect(qaTimelineQuerySchema.parse({})).toEqual({});
    for (const bad of ['0', '61', '2.5', 'x']) expect(qaTimelineQuerySchema.safeParse({ bucketSeconds: bad }).success).toBe(false);
  });
});

describe('línea de tiempo: repositorio', () => {
  it('lastBucketIndex cubre la ventana y se acota al máximo de tramos', () => {
    const start = START;
    expect(lastBucketIndex({ start, end: new Date('2026-09-24T10:00:12Z'), bucketSeconds: 5 })).toBe(2);
    expect(lastBucketIndex({ start, end: new Date('2026-09-24T10:00:10Z'), bucketSeconds: 5 })).toBe(1);
    expect(lastBucketIndex({ start, end: start, bucketSeconds: 5 })).toBe(0);
    expect(lastBucketIndex({ start, end: new Date('2026-09-30T10:00:00Z'), bucketSeconds: 1 })).toBe(QA_TIMELINE_MAX_BUCKETS - 1);
  });

  it('agrega en SQL: expande los intentos, percentiles en la base y el mismo bind en tramos y totales', async () => {
    const calls: Array<{ sql: string; bind: unknown }> = [];
    const sequelize = {
      query: jest.fn(async (sql: string, options: { bind: unknown }) => {
        calls.push({ sql, bind: options.bind });
        return sql === TIMELINE_TOTALS_SQL ? [{ requests: 4, errors: 0, p50: 10, p95: 20 }] : [{ idx: 0 }];
      }),
    };
    const repo = new QaRunTimelineRepository(sequelize as unknown as Sequelize);
    const result = await repo.timeline({ runId: '9', start: START, end: new Date('2026-09-24T10:00:12Z'), bucketSeconds: 5 });
    expect(result).toEqual({ buckets: [{ idx: 0 }], totals: { requests: 4, errors: 0, p50: 10, p95: 20 } });
    expect(calls.map((call) => call.sql)).toEqual([TIMELINE_BUCKETS_SQL, TIMELINE_TOTALS_SQL]);
    for (const call of calls) expect(call.bind).toEqual({ runId: '9', start: START, bucket: 5, lastIdx: 2 });
    for (const fragment of ['jsonb_array_elements', 'percentile_cont(0.95)', "s.status = 'FAILED'", 'finished_at IS NOT NULL'])
      expect(TIMELINE_TOTALS_SQL).toContain(fragment);
    expect(TIMELINE_BUCKETS_SQL).toContain('generate_series(0, $lastIdx::int)');
    expect(TIMELINE_BUCKETS_SQL).toContain('p.finished_at IS NULL OR p.finished_at >= b.b_start');
  });

  it('sin fila de totales devuelve null', async () => {
    const sequelize = { query: jest.fn(async () => []) };
    const repo = new QaRunTimelineRepository(sequelize as unknown as Sequelize);
    expect((await repo.timeline({ runId: '9', start: START, end: START, bucketSeconds: 1 })).totals).toBeNull();
  });
});
