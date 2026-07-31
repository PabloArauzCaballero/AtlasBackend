import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RuntimeJobsSchedulerService } from '../../../src/modules/runtime-jobs/runtime-jobs-scheduler.service.js';
import { env } from '../../../src/config/env.js';

/**
 * Separación de roles de proceso (`docs/architecture/background-processing.md`).
 *
 * Lo que se protege aquí es que un despliegue con API y worker separados no acabe ejecutando el
 * trabajo de fondo dos veces —una en cada réplica de API y otra en el worker— ni ninguna. El fallo
 * en ambos sentidos es silencioso: nadie recibe un error, sólo hay trabajo duplicado o ausente.
 */
describe('RuntimeJobsSchedulerService · rol del proceso', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalEnv: Record<string, unknown> = {};

  const setEnv = (key: string, value: unknown) => {
    if (!(key in originalEnv)) originalEnv[key] = mutableEnv[key];
    mutableEnv[key] = value;
  };

  beforeEach(() => {
    jest.spyOn(global, 'setInterval');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) mutableEnv[key] = value;
    for (const key of Object.keys(originalEnv)) delete originalEnv[key];
    jest.restoreAllMocks();
  });

  function build() {
    const runtimeJobs = {
      processOutbox: jest.fn(async () => ({ status: 'completed' })),
      processEvents: jest.fn(async () => ({ status: 'completed' })),
      expireStaleSessions: jest.fn(async () => ({ status: 'completed' })),
      applyRetentionPolicies: jest.fn(async () => ({ status: 'completed' })),
      recalculateDataQuality: jest.fn(async () => ({ status: 'completed' })),
    };
    const maintenance = {
      retryStuckNotifications: jest.fn(async () => ({ status: 'completed' })),
      purgeIdempotencyKeys: jest.fn(async () => ({ status: 'completed' })),
      deliverPendingNotifications: jest.fn(async () => ({ status: 'completed' })),
    };
    const service = new RuntimeJobsSchedulerService(
      runtimeJobs as never,
      maintenance as never,
      { findAll: jest.fn(async () => [{ id: 1 }]) } as never,
      { set: jest.fn(async () => 'OK') } as never,
      { recordScheduledJob: jest.fn() } as never,
    );
    return { service, maintenance };
  }

  const jobsOf = (service: RuntimeJobsSchedulerService) => (service as unknown as { jobs: () => Array<{ jobCode: string }> }).jobs();

  it('con APP_ROLE=api no programa NINGÚN timer, aunque el planificador esté habilitado', () => {
    setEnv('APP_ROLE', 'api');
    setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
    const { service } = build();

    service.onApplicationBootstrap();

    expect(setInterval).not.toHaveBeenCalled();
  });

  it('con APP_ROLE=worker programa los jobs', () => {
    setEnv('APP_ROLE', 'worker');
    setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
    const { service } = build();

    service.onApplicationBootstrap();

    expect(setInterval).toHaveBeenCalledTimes(7);
    service.onModuleDestroy();
  });

  describe('job de entrega diferida', () => {
    it('NO existe en modo inline: competiría con el proceso que acaba de crear los mensajes', () => {
      setEnv('NOTIFICATIONS_DELIVERY_MODE', 'inline');
      const { service } = build();

      expect(jobsOf(service).map((job) => job.jobCode)).not.toContain('deliver_pending_notifications');
    });

    it('se programa en modo deferred, con su propio intervalo corto', () => {
      setEnv('NOTIFICATIONS_DELIVERY_MODE', 'deferred');
      setEnv('RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS', 10_000);
      const { service } = build();

      const job = jobsOf(service).find((entry) => entry.jobCode === 'deliver_pending_notifications');

      expect(job).toBeDefined();
      expect((job as unknown as { intervalMs: number }).intervalMs).toBe(10_000);
    });

    it('ejecuta la entrega sin dryRun: el planificador existe para entregar, no para simular', async () => {
      setEnv('NOTIFICATIONS_DELIVERY_MODE', 'deferred');
      const { service, maintenance } = build();
      const job = jobsOf(service).find((entry) => entry.jobCode === 'deliver_pending_notifications');

      await (job as unknown as { run: (tenantId: string) => Promise<unknown> }).run('7');

      expect(maintenance.deliverPendingNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '7', body: expect.objectContaining({ dryRun: false }) }),
      );
    });
  });
});
