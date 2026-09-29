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

  it('getTrafficLatencyReport dice cuándo la tabla enseña sólo las rutas con más tráfico', async () => {
    const { service, actionLogRepository } = build();
    const fila = (routes_total: string) => ({
      route_template: '/x',
      method: 'GET',
      total_requests: '1',
      error_count: '0',
      avg_latency_ms: '1',
      p95_latency_ms: '1',
      last_seen_at: null,
      overall_total_requests: '1',
      overall_error_count: '0',
      overall_avg_latency_ms: '1',
      overall_p95_latency_ms: '1',
      routes_total,
    });
    (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([fila('73')] as never);
    const cortado = await service.getTrafficLatencyReport(24, user);
    expect(cortado).toMatchObject({ routesTotal: 73, routesTruncated: true });

    (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([fila('1')] as never);
    const completo = await service.getTrafficLatencyReport(24, user);
    expect(completo).toMatchObject({ routesTotal: 1, routesTruncated: false });
  });

  describe('getTrafficLatencyReport · buscar, filtrar y paginar', () => {
    const ruta = (over: Record<string, unknown> = {}) => ({
      route_template: '/api/v1/auth/login',
      method: 'POST',
      total_requests: '10',
      error_count: '0',
      avg_latency_ms: '5',
      p95_latency_ms: '9',
      last_seen_at: null,
      route_present: true,
      overall_total_requests: '500',
      overall_error_count: '5',
      overall_avg_latency_ms: '7',
      overall_p95_latency_ms: '30',
      routes_total: '73',
      routes_matching: '3',
      ...over,
    });

    it('sin limit no pagina: pide las 50 de siempre y no inventa `meta`', async () => {
      const { service, actionLogRepository } = build();
      (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([ruta({ routes_matching: '73' })] as never);
      const res = await service.getTrafficLatencyReport(24, user);
      expect(actionLogRepository.getTrafficLatencyByRoute).toHaveBeenCalledWith(expect.any(Date), 't1', {
        q: undefined,
        method: undefined,
        limit: undefined,
        offset: 0,
      });
      expect(res.meta).toBeUndefined();
      expect(res.routesTruncated).toBe(true);
    });

    it('el buscador, el método y la página viajan al repositorio y `meta.total` cuenta las coincidencias', async () => {
      const { service, actionLogRepository } = build();
      (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([ruta()] as never);
      const res = await service.getTrafficLatencyReport(24, user, { q: 'auth', method: 'POST', page: 3, limit: 20 });
      expect(actionLogRepository.getTrafficLatencyByRoute).toHaveBeenCalledWith(expect.any(Date), 't1', {
        q: 'auth',
        method: 'POST',
        limit: 20,
        offset: 40,
      });
      expect(res.meta).toEqual({ page: 3, limit: 20, total: 3, totalPages: 1 });
      // Con página no hay «corte»: lo que falta está en la página siguiente.
      expect(res.routesTruncated).toBe(false);
    });

    it('si el buscador no encuentra nada, `summary` sigue siendo el de la ventana y `routes` queda vacío', async () => {
      const { service, actionLogRepository } = build();
      (actionLogRepository.getTrafficLatencyByRoute as jest.Mock).mockResolvedValueOnce([
        ruta({ route_present: false, route_template: null, method: null, total_requests: null, routes_matching: '0' }),
      ] as never);
      const res = await service.getTrafficLatencyReport(24, user, { q: 'zzz', limit: 20 });
      expect(res.routes).toEqual([]);
      expect(res.summary).toMatchObject({ totalRequests: 500, avgLatencyMs: 7, p95LatencyMs: 30 });
      expect(res.routesTotal).toBe(73);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });
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
