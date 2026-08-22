import { describe, expect, it, jest } from '@jest/globals';
import { SystemsActionLogQueryService } from '../../../src/modules/systems-ops/systems-action-log-query.service.js';

/**
 * `SystemsActionLogQueryService` lee el log de acciones HTTP y arma reportes de tráfico/latencia. La
 * lógica interesante es de cálculo (redondeo, error-rate, elección de bucket y relleno de huecos con
 * ceros en la serie de tiempo). Spec directo con el repo mockeado.
 */
describe('SystemsActionLogQueryService', () => {
  function build() {
    const actionLogRepository = {
      listActionLogs: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findActionLogsByRequest: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      getTrafficLatencyByRoute: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      getTrafficLatencyTimeseries: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    };
    const service = new SystemsActionLogQueryService(actionLogRepository as never);
    return { service, actionLogRepository };
  }

  const user = { role: 'internal_operator', tenantId: 't1', internalUserId: 'u1' } as never;

  it('listActionLogs aplica el scope de tenant y mapea las filas', async () => {
    const { service, actionLogRepository } = build();
    (actionLogRepository.listActionLogs as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, requestId: 'r1', method: 'GET' }],
      meta: { page: 1 },
    } as never);
    const res = await service.listActionLogs({} as never, user);
    expect(actionLogRepository.listActionLogs).toHaveBeenCalledWith({}, 't1');
    expect(res.items[0]).toMatchObject({ actionLogId: '1', requestId: 'r1' });
    expect(res.meta).toEqual({ page: 1 });
  });

  it('getActionLogsByRequest mapea las filas del request', async () => {
    const { service, actionLogRepository } = build();
    (actionLogRepository.findActionLogsByRequest as jest.Mock).mockResolvedValueOnce([{ id: 2, requestId: 'r2' }] as never);
    const res = await service.getActionLogsByRequest('r2', user);
    expect(actionLogRepository.findActionLogsByRequest).toHaveBeenCalledWith('r2', 't1');
    expect(res.items[0]).toMatchObject({ actionLogId: '2' });
  });

  it('getTrafficLatencyReport calcula por ruta (redondeo, error-rate) y el resumen global', async () => {
    const { service, actionLogRepository } = build();
    (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([
      {
        route_template: '/api/v1/x',
        method: 'GET',
        total_requests: '100',
        error_count: '5',
        avg_latency_ms: '12.4',
        p95_latency_ms: '40.9',
        last_seen_at: '2026-01-01T00:00:00.000Z',
        overall_total_requests: '100',
        overall_error_count: '5',
        overall_avg_latency_ms: '12.4',
        overall_p95_latency_ms: '40.9',
      },
    ] as never);
    const res = await service.getTrafficLatencyReport(24, user);
    expect(res.routes[0]).toMatchObject({
      routeTemplate: '/api/v1/x',
      totalRequests: 100,
      avgLatencyMs: 12,
      p95LatencyMs: 41,
      errorRate: 0.05,
    });
    expect(res.summary).toMatchObject({ totalRequests: 100, avgLatencyMs: 12, p95LatencyMs: 41, errorRate: 0.05 });
    expect(res.windowHours).toBe(24);
  });

  it('getTrafficLatencyReport tolera latencias null y filas vacías (sin dividir por cero)', async () => {
    const { service, actionLogRepository } = build();
    (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([
      {
        route_template: '/y',
        method: 'POST',
        total_requests: '0',
        error_count: '0',
        avg_latency_ms: null,
        p95_latency_ms: null,
        last_seen_at: null,
      },
    ] as never);
    const res = await service.getTrafficLatencyReport(6, user);
    expect(res.routes[0]).toMatchObject({ avgLatencyMs: null, p95LatencyMs: null, errorRate: 0 });
    // summary usa overall_* que aquí no vienen -> ceros
    expect(res.summary.totalRequests).toBe(0);
    expect(res.summary.errorRate).toBe(0);
  });

  it('getTrafficLatencyReport con cero rutas da un resumen vacío', async () => {
    const { service } = build();
    const res = await service.getTrafficLatencyReport(1, user);
    expect(res.routes).toEqual([]);
    expect(res.summary).toMatchObject({ totalRequests: 0, avgLatencyMs: 0, p95LatencyMs: 0, errorRate: 0 });
  });

  it('getTrafficLatencyTimeseries elige el bucket según la ventana', async () => {
    const { service } = build();
    expect((await service.getTrafficLatencyTimeseries(1, user)).bucketMinutes).toBe(5);
    expect((await service.getTrafficLatencyTimeseries(6, user)).bucketMinutes).toBe(15);
    expect((await service.getTrafficLatencyTimeseries(24, user)).bucketMinutes).toBe(30);
    expect((await service.getTrafficLatencyTimeseries(48, user)).bucketMinutes).toBe(120);
  });

  it('getTrafficLatencyTimeseries rellena con ceros los buckets sin tráfico', async () => {
    const { service } = build();
    const res = await service.getTrafficLatencyTimeseries(1, user);
    expect(res.buckets.length).toBeGreaterThan(0);
    for (const bucket of res.buckets) {
      expect(bucket).toMatchObject({ totalRequests: 0, avgLatencyMs: 0, p95LatencyMs: 0, errorRate: 0 });
      expect(typeof bucket.bucketStart).toBe('string');
    }
  });
});
