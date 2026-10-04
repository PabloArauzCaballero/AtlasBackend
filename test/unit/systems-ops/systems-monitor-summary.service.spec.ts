import { describe, expect, it, jest } from '@jest/globals';
import { SystemsMonitorSummaryService } from '../../../src/modules/systems-ops/systems-monitor-summary.service.js';

type Overrides = {
  network?: () => Promise<unknown>;
  providers?: () => Promise<unknown>;
  business?: Record<string, string | null>;
};

function build(overrides: Overrides = {}) {
  const trafficRows = jest.fn(async (_from: Date, _tenant: string | null) => [
    {
      route_present: true,
      route_template: '/api/v1/slow',
      method: 'GET',
      total_requests: '50',
      p95_latency_ms: '1800',
      overall_total_requests: '200',
      overall_error_count: '2',
      overall_avg_latency_ms: '120',
      overall_p95_latency_ms: '900',
    },
  ]);
  const query = jest.fn(async (_sql: string, _options: unknown) => [
    overrides.business ?? {
      customers_new: '3',
      applications_new: '2',
      applications_approved: '1',
      loans_new: '1',
      payments_new: '4',
      merchants_new: '1',
      merchants_approved: '5',
      review_open: '2',
      review_oldest_hours: '30.26',
      outbox_pending: '7',
    },
  ]);
  const service = new SystemsMonitorSummaryService(
    {
      getNetworkHealth:
        overrides.network ??
        (async () => ({
          overallState: 'UP',
          blocksUp: 3,
          blocksDown: 0,
          blocks: [{ systemCode: 'ERP_BACKEND', liveState: 'UP', isCritical: true, healthMessage: 'ok' }],
        })),
    } as never,
    {
      getToolsHealth: async () => [
        { code: 'redis', name: 'Redis', isCritical: true, isHealthy: true, healthMessage: 'ok' },
        { code: 'mail', name: 'Correo', isCritical: false, isHealthy: false, healthMessage: 'caído' },
      ],
    } as never,
    { getTrafficLatencyByRoute: trafficRows } as never,
    {
      getDashboard:
        overrides.providers ??
        (async () => ({
          totals: { providers: 4, respondingProviders: 4, unmeasuredProviders: 0, successRate: 97 },
        })),
    } as never,
    { summarize: async () => ({ configured: true, pending: 0, retrying: 1, exhausted: 0 }) } as never,
    { query } as never,
  );
  return { service, trafficRows, query };
}

describe('SystemsMonitorSummaryService', () => {
  it('compone los bloques con su semáforo y el peor estado manda', async () => {
    const { service } = build();
    const summary = await service.summarize('1');

    expect(summary.network).toMatchObject({ status: 'ok', blocksUp: 3 });
    // La herramienta caída NO es crítica: el portal la ignora y el resumen también.
    expect(summary.criticalTools).toMatchObject({ status: 'ok', down: [] });
    expect(summary.traffic.last24h).toMatchObject({ status: 'ok', totalRequests: 200, p95LatencyMs: 900 });
    expect(summary.traffic.last24h).toHaveProperty('slowestRoute', { method: 'GET', route: '/api/v1/slow', p95LatencyMs: 1800 });
    expect(summary.providers).toMatchObject({ status: 'ok' });
    expect(summary.outcomes).toMatchObject({ status: 'warn', retrying: 1 });
    expect(summary.queue).toMatchObject({ status: 'warn', reviewOpen: 2, oldestOpenAgeHours: 30.3 });
    expect(summary.business).toMatchObject({ last24h: { customersNew: 3, paymentsNew: 4 }, merchantsApproved: 5 });
    expect(summary.outbox).toEqual({ pending: 7 });
    expect(summary.overall).toBe('warn');
  });

  it('un bloque que falla queda en unknown con el motivo y no tumba el resto', async () => {
    const { service } = build({
      providers: async () => {
        throw new Error('data_provider_requests no responde');
      },
    });
    const summary = await service.summarize('1');

    expect(summary.providers).toEqual({ status: 'unknown', error: 'data_provider_requests no responde' });
    expect(summary.network.status).toBe('ok');
    expect(summary.business).toHaveProperty('last24h');
  });

  it('un bloque de red caído pone el resumen en rojo', async () => {
    const { service } = build({
      network: async () => ({ overallState: 'DOWN', blocksUp: 2, blocksDown: 1, blocks: [] }),
    });
    expect((await service.summarize('1')).overall).toBe('bad');
  });

  it('acota todo por el tenant que llega del token, no por otro', async () => {
    const { service, trafficRows, query } = build();
    await service.summarize('42');

    expect(trafficRows).toHaveBeenCalledTimes(2);
    for (const call of trafficRows.mock.calls) expect(call[1]).toBe('42');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('_tenant_id = CAST(:t AS bigint)'),
      expect.objectContaining({ replacements: { t: '42' } }),
    );
  });

  it('sin casos abiertos la cola no tiene antigüedad y no avisa', async () => {
    const { service } = build({
      business: { review_open: '0', review_oldest_hours: null, outbox_pending: '0' },
    });
    expect((await service.summarize('1')).queue).toEqual({ status: 'ok', reviewOpen: 0, oldestOpenAgeHours: null });
  });
});
