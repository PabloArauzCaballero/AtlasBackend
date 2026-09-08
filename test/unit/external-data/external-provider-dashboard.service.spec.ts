import { describe, expect, it } from '@jest/globals';
import { ExternalProviderDashboardService } from '../../../src/modules/external-data/application/external-provider-dashboard.service.js';

/**
 * El tablero de proveedores externos. Lo que se fija aquí es lo que distingue un tablero ÚTIL de
 * uno que miente: que "nadie llamó" no se pinte igual que "todo falló", que un proveedor sin
 * chequear no cuente como caído, y que un filtro por un proveedor inexistente devuelva vacío en
 * lugar de devolverlo todo.
 */

type Row = Record<string, unknown>;

function request(overrides: Row = {}): Row {
  return {
    id: 1,
    providerId: '10',
    customerId: '5',
    responseStatus: 'MOCKED',
    latencyMs: 100,
    estimatedCostAmount: null,
    actualCostAmount: null,
    requestedAt: new Date('2026-09-08T10:00:00Z'),
    respondedAt: new Date('2026-09-08T10:00:01Z'),
    errorMessageSafe: null,
    ...overrides,
  };
}

function provider(overrides: Row = {}): Row {
  return {
    id: '10',
    providerCode: 'SEGIP',
    providerName: 'SEGIP / CGIP Identity Verification',
    providerCategory: 'IDENTITY',
    providerStatus: 'ACTIVE',
    defaultMode: 'mock_server',
    isActive: true,
    isCostly: false,
    requiresManualApproval: false,
    ...overrides,
  };
}

function healthLog(overrides: Row = {}): Row {
  return {
    status: 'UP',
    latencyMs: 42,
    checkedAt: new Date('2026-09-08T11:00:00Z'),
    modeChecked: 'mock_server',
    errorCode: null,
    errorMessageSafe: null,
    ...overrides,
  };
}

function build(input: { providers: Row[]; requests?: Row[]; healthLogs?: Row[]; page?: { rows: Row[]; count: number } }) {
  const repository = { listProviders: async () => input.providers };
  const dashboardRepository = {
    listRequestsInWindow: async () => input.requests ?? [],
    listRecentHealthLogs: async () => input.healthLogs ?? [],
    listRequestsPage: async () => input.page ?? { rows: [], count: 0 },
  };
  return new ExternalProviderDashboardService(repository as never, dashboardRepository as never);
}

describe('ExternalProviderDashboardService', () => {
  it('un proveedor sin llamadas tiene successRate null, no 0 — no se le puede acusar de fallar', async () => {
    const service = build({ providers: [provider()], healthLogs: [healthLog()] });

    const dashboard = await service.getDashboard({ days: 1, healthPoints: 30 });

    expect(dashboard.providers[0].activity.total).toBe(0);
    expect(dashboard.providers[0].activity.successRate).toBeNull();
    expect(dashboard.providers[0].activity.p95LatencyMs).toBeNull();
    expect(dashboard.totals.successRate).toBeNull();
  });

  it('agrega éxito, fallo y bloqueo por proveedor, y guarda el último error con su mensaje', async () => {
    const service = build({
      providers: [provider()],
      requests: [
        request({ id: 3, responseStatus: 'PROVIDER_UNAVAILABLE', errorMessageSafe: 'El proveedor no respondió.' }),
        request({ id: 2, responseStatus: 'BLOCKED_BY_COST_POLICY' }),
        request({ id: 1, responseStatus: 'COMPLETED', latencyMs: 200, actualCostAmount: '12.5' }),
      ],
      healthLogs: [healthLog()],
    });

    const activity = (await service.getDashboard({ days: 1, healthPoints: 30 })).providers[0].activity;

    expect(activity).toMatchObject({
      total: 3,
      success: 1,
      failed: 1,
      blocked: 1,
      successRate: 33.33,
      actualCost: 12.5,
      lastErrorStatus: 'PROVIDER_UNAVAILABLE',
      lastErrorMessage: 'El proveedor no respondió.',
    });
  });

  it('un proveedor sin ningún chequeo cuenta como «sin medir», no como caído', async () => {
    const service = build({ providers: [provider()], healthLogs: [] });

    const totals = (await service.getDashboard({ days: 1, healthPoints: 30 })).totals;

    expect(totals).toMatchObject({ providers: 1, respondingProviders: 0, unmeasuredProviders: 1 });
    expect((await service.getDashboard({ days: 1, healthPoints: 30 })).providers[0].health).toBeNull();
  });

  it('la serie de salud se devuelve de la más antigua a la más reciente, para dibujarla', async () => {
    const service = build({
      providers: [provider()],
      healthLogs: [
        healthLog({ checkedAt: new Date('2026-09-08T11:00:00Z'), latencyMs: 30 }),
        healthLog({ checkedAt: new Date('2026-09-08T10:00:00Z'), latencyMs: 20 }),
      ],
    });

    const row = (await service.getDashboard({ days: 1, healthPoints: 30 })).providers[0];

    expect(row.healthSeries.map((point) => point.latencyMs)).toEqual([20, 30]);
    // La "última" salud sigue siendo la más reciente, no la primera de la serie.
    expect(row.health?.latencyMs).toBe(30);
  });

  it('filtrar por un proveedor que no existe devuelve vacío, nunca todas las solicitudes', async () => {
    const service = build({ providers: [provider()], page: { rows: [request()], count: 1 } });

    const result = await service.listRequests({ days: 7, providerCode: 'NO_EXISTE', limit: 50, offset: 0 });

    expect(result.total).toBe(0);
    expect(result.requests).toEqual([]);
  });

  it('el listado expone el código del proveedor, no su id interno', async () => {
    const service = build({ providers: [provider()], page: { rows: [request()], count: 1 } });

    const result = await service.listRequests({ days: 7, limit: 50, offset: 0 });

    expect(result.requests[0]).toMatchObject({ requestId: '1', providerCode: 'SEGIP', responseStatus: 'MOCKED' });
    expect(result.requests[0]).not.toHaveProperty('providerId');
  });
});
