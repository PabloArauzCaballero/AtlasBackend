import { describe, expect, it, jest } from '@jest/globals';
import { SystemsHealthMonitorService } from '../../../src/modules/systems-ops/systems-health-monitor.service.js';
import type { SystemsHealthStatus } from '../../../src/modules/systems-ops/systems-ops.dtos.js';

/**
 * Regla central de este monitor: solo notifica en TRANSICIONES de estado de una herramienta
 * `isCritical`, no en cada chequeo — de lo contrario un servicio caído generaría una notificación
 * nueva cada `SYSTEM_HEALTH_MONITOR_INTERVAL_MS` mientras siga caído.
 */
function tool(overrides: Partial<SystemsHealthStatus> = {}): SystemsHealthStatus {
  return {
    code: 'POSTGRES',
    name: 'PostgreSQL',
    status: 'ACTIVE',
    isConfigured: true,
    missingEnvVars: [],
    isCritical: true,
    isWorker: false,
    checkType: 'LIVE',
    isHealthy: true,
    healthMessage: 'PostgreSQL respondió correctamente.',
    ...overrides,
  };
}

function buildService(getToolsHealthImpl: () => Promise<SystemsHealthStatus[]>) {
  const healthService = { getToolsHealth: jest.fn(getToolsHealthImpl) };
  const broadcastService = { notifyAllInternalUsers: jest.fn(async () => []) };
  const service = new SystemsHealthMonitorService(healthService as never, broadcastService as never);
  return { service, healthService, broadcastService };
}

// `checkOnce` es privado — se llega a él invocando el ciclo público a través de `onApplicationBootstrap`
// estaría atado a env/setInterval real; en su lugar se accede al método privado directamente vía cast,
// igual que otros tests de este repo hacen con lógica interna no expuesta a propósito.
async function runCheckOnce(service: SystemsHealthMonitorService): Promise<void> {
  await (service as unknown as { checkOnce: () => Promise<void> }).checkOnce();
}

describe('SystemsHealthMonitorService', () => {
  it('does NOT notify on the very first check when a critical tool is already healthy', async () => {
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: true })]);
    await runCheckOnce(service);
    expect(broadcastService.notifyAllInternalUsers).not.toHaveBeenCalled();
  });

  it('notifies "servicio caído" the first time a critical tool is seen unhealthy', async () => {
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: false, healthMessage: 'Connection refused' })]);
    await runCheckOnce(service);

    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(1);
    const [tenantId, content] = (broadcastService.notifyAllInternalUsers as jest.Mock).mock.calls[0] as [
      string | null,
      { title: string; category: string; priority: number },
    ];
    expect(tenantId).toBeNull(); // alerta de infraestructura -> todos los tenants
    expect(content.title).toContain('PostgreSQL');
    expect(content.category).toBe('system_alert');
    expect(content.priority).toBe(100);
  });

  it('does NOT re-notify on a second check while the tool is still down (state transition only)', async () => {
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: false })]);
    await runCheckOnce(service);
    await runCheckOnce(service);
    await runCheckOnce(service);

    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(1);
  });

  it('notifies "servicio recuperado" when a down tool becomes healthy again, with lower priority', async () => {
    let healthy = false;
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: healthy })]);

    await runCheckOnce(service); // down -> 1 notificación
    healthy = true;
    await runCheckOnce(service); // recovered -> 2da notificación

    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(2);
    const secondCall = (broadcastService.notifyAllInternalUsers as jest.Mock).mock.calls[1] as [
      string | null,
      { title: string; priority: number },
    ];
    expect(secondCall[1].title).toContain('recuperado');
    expect(secondCall[1].priority).toBeLessThan(100);
  });

  it('ignores non-critical tools entirely, even when unhealthy', async () => {
    const { service, broadcastService } = buildService(async () => [
      tool({ code: 'OPENAPI_SWAGGER', isCritical: false, isHealthy: false }),
    ]);
    await runCheckOnce(service);
    expect(broadcastService.notifyAllInternalUsers).not.toHaveBeenCalled();
  });

  it('a transition to/from null (no active probe) is not treated as down or recovered', async () => {
    let current: boolean | null = null;
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: current })]);

    await runCheckOnce(service); // null on the very first check
    current = false;
    await runCheckOnce(service); // null -> false IS a real transition to down
    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(1);

    current = null;
    await runCheckOnce(service); // false -> null must NOT be treated as "recovered"
    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(1);
  });

  it('tracks each tool code independently — one tool going down does not affect another', async () => {
    const { service, broadcastService } = buildService(async () => [
      tool({ code: 'POSTGRES', isHealthy: false }),
      tool({ code: 'REDIS', name: 'Redis', isHealthy: true }),
    ]);
    await runCheckOnce(service);

    expect(broadcastService.notifyAllInternalUsers).toHaveBeenCalledTimes(1);
    const [, content] = (broadcastService.notifyAllInternalUsers as jest.Mock).mock.calls[0] as [string | null, { title: string }];
    expect(content.title).toContain('PostgreSQL');
  });

  it('does not throw when getToolsHealth() itself fails (transient infra hiccup)', async () => {
    const { service, broadcastService } = buildService(async () => {
      throw new Error('DB unreachable');
    });
    await expect(runCheckOnce(service)).resolves.toBeUndefined();
    expect(broadcastService.notifyAllInternalUsers).not.toHaveBeenCalled();
  });

  it('does not throw when notifyAllInternalUsers itself fails — a broken notification must not crash the health check loop', async () => {
    const { service, broadcastService } = buildService(async () => [tool({ isHealthy: false })]);
    (broadcastService.notifyAllInternalUsers as jest.Mock).mockRejectedValueOnce(new Error('DB down too') as never);

    await expect(runCheckOnce(service)).resolves.toBeUndefined();
  });
});
