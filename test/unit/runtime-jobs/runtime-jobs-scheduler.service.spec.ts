import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RuntimeJobsSchedulerService } from '../../../src/modules/runtime-jobs/runtime-jobs-scheduler.service.js';
import { env } from '../../../src/config/env.js';

/**
 * Hallazgo A-03 de `docs/audit/auditoria-integral-2026-07-30.md`: los cinco jobs de fondo solo
 * existían como endpoints HTTP y nada los llamaba, así que en producción el outbox no se despachaba
 * y las políticas de retención de datos personales no se aplicaban nunca.
 *
 * Lo que estas pruebas fijan es el contrato del planificador, no su reloj: `tick` se invoca
 * directamente (es privado, se accede por cast) en vez de esperar a `setInterval`, para que la
 * prueba sea determinista y no dependa de temporizadores.
 *
 * `env` es un objeto plano no congelado, así que se muta y se restaura por prueba.
 */
describe('RuntimeJobsSchedulerService', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalEnv: Record<string, unknown> = {};

  const setEnv = (key: string, value: unknown) => {
    if (!(key in originalEnv)) originalEnv[key] = mutableEnv[key];
    mutableEnv[key] = value;
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) mutableEnv[key] = value;
    for (const key of Object.keys(originalEnv)) delete originalEnv[key];
    jest.restoreAllMocks();
  });

  function build(options: { redis?: unknown } = {}) {
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
    };
    const tenantModel = { findAll: jest.fn(async () => [{ id: 1 }, { id: 2 }]) };
    const metrics = { recordScheduledJob: jest.fn() };
    const redis = options.redis === undefined ? { set: jest.fn(async () => 'OK') } : options.redis;
    const service = new RuntimeJobsSchedulerService(
      runtimeJobs as never,
      maintenance as never,
      tenantModel as never,
      redis as never,
      metrics as never,
    );
    return { service, runtimeJobs, maintenance, tenantModel, metrics, redis };
  }

  /** Acceso al método privado que ejecuta una tanda, sin esperar al temporizador. */
  const tick = (service: RuntimeJobsSchedulerService, job: { jobCode: string; intervalMs: number; run: (t: string) => Promise<unknown> }) =>
    (service as unknown as { tick: (job: unknown) => Promise<void> }).tick(job);

  const jobsOf = (service: RuntimeJobsSchedulerService) =>
    (service as unknown as { jobs: () => Array<{ jobCode: string; intervalMs: number; run: (t: string) => Promise<unknown> }> }).jobs();

  describe('arranque', () => {
    beforeEach(() => {
      jest.spyOn(global, 'setInterval');
    });

    it('no programa nada si el planificador está deshabilitado', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', false);
      const { service } = build();

      service.onApplicationBootstrap();

      expect(setInterval).not.toHaveBeenCalled();
    });

    it('programa los siete jobs cuando está habilitado', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      const { service } = build();

      service.onApplicationBootstrap();

      expect(setInterval).toHaveBeenCalledTimes(7);
      service.onModuleDestroy();
    });

    it('en producción sin Redis NO arranca: no hay forma de impedir que N instancias procesen el mismo lote', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('NODE_ENV', 'production');
      setEnv('RUNTIME_JOBS_ALLOW_WITHOUT_LOCK', false);
      const { service } = build({ redis: null });

      service.onApplicationBootstrap();

      expect(setInterval).not.toHaveBeenCalled();
    });

    it('en producción sin Redis arranca si se asume el riesgo explícitamente', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('NODE_ENV', 'production');
      setEnv('RUNTIME_JOBS_ALLOW_WITHOUT_LOCK', true);
      const { service } = build({ redis: null });

      service.onApplicationBootstrap();

      expect(setInterval).toHaveBeenCalledTimes(7);
      service.onModuleDestroy();
    });
  });

  describe('elección de líder', () => {
    it('toma el lock con SET NX PX y ejecuta el job para cada tenant activo', async () => {
      const { service, runtimeJobs, redis, metrics } = build();
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect((redis as { set: jest.Mock }).set).toHaveBeenCalledWith(
        'atlas:jobs:leader:process_outbox',
        expect.any(String),
        'PX',
        expect.any(Number),
        'NX',
      );
      expect(runtimeJobs.processOutbox).toHaveBeenCalledTimes(2);
      expect(metrics.recordScheduledJob).toHaveBeenCalledWith({ job: 'process_outbox', outcome: 'success' });
    });

    it('si otra instancia tiene el lock, se salta la tanda sin tocar la base', async () => {
      const { service, runtimeJobs, tenantModel } = build({ redis: { set: jest.fn(async () => null) } });
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect(tenantModel.findAll).not.toHaveBeenCalled();
      expect(runtimeJobs.processOutbox).not.toHaveBeenCalled();
    });

    it('si Redis falla, se salta la tanda en vez de correr sin lock', async () => {
      const { service, runtimeJobs } = build({
        redis: {
          set: jest.fn(async () => {
            throw new Error('ECONNREFUSED');
          }),
        },
      });
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect(runtimeJobs.processOutbox).not.toHaveBeenCalled();
    });

    it('sin Redis configurado (desarrollo, una sola instancia) ejecuta igual', async () => {
      const { service, runtimeJobs } = build({ redis: null });
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect(runtimeJobs.processOutbox).toHaveBeenCalledTimes(2);
    });
  });

  describe('ejecución', () => {
    it('nunca usa dryRun: el planificador existe para ejecutar, no para simular', async () => {
      const { service, runtimeJobs, maintenance } = build();

      for (const job of jobsOf(service)) await tick(service, job);

      const bodies = [
        (runtimeJobs.processOutbox as jest.Mock).mock.calls[0][0],
        (runtimeJobs.processEvents as jest.Mock).mock.calls[0][0],
        (runtimeJobs.expireStaleSessions as jest.Mock).mock.calls[0][0],
        (runtimeJobs.applyRetentionPolicies as jest.Mock).mock.calls[0][0],
        (runtimeJobs.recalculateDataQuality as jest.Mock).mock.calls[0][0],
        (maintenance.retryStuckNotifications as jest.Mock).mock.calls[0][0],
        (maintenance.purgeIdempotencyKeys as jest.Mock).mock.calls[0][0],
      ] as Array<{ body: { dryRun: boolean }; currentUser: { role: string; sub: string } }>;

      for (const call of bodies) {
        expect(call.body.dryRun).toBe(false);
        expect(call.currentUser.role).toBe('system');
        expect(call.currentUser.sub).toBe('runtime-jobs-scheduler');
      }
    });

    it('un tenant que falla no cancela a los demás y se contabiliza como fallo', async () => {
      const { service, runtimeJobs, metrics } = build();
      (runtimeJobs.processOutbox as jest.Mock)
        .mockRejectedValueOnce(new Error('deadlock') as never)
        .mockResolvedValueOnce({ status: 'completed' } as never);
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect(runtimeJobs.processOutbox).toHaveBeenCalledTimes(2);
      expect(metrics.recordScheduledJob).toHaveBeenCalledWith({ job: 'process_outbox', outcome: 'failure' });
      expect(metrics.recordScheduledJob).toHaveBeenCalledWith({ job: 'process_outbox', outcome: 'success' });
    });

    it('tras onModuleDestroy una tanda en vuelo no ejecuta nada más', async () => {
      const { service, runtimeJobs } = build();
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');
      service.onModuleDestroy();

      await tick(service, outbox!);

      expect(runtimeJobs.processOutbox).not.toHaveBeenCalled();
    });
  });
});
