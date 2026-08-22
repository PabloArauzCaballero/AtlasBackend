import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RuntimeJobsSchedulerService } from '../../../src/modules/runtime-jobs/runtime-jobs-scheduler.service.js';
import { buildScheduledJobs } from '../../../src/modules/runtime-jobs/scheduled-jobs.catalog.js';
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
      processOutbox: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      processEvents: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      expireStaleSessions: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      applyRetentionPolicies: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      recalculateDataQuality: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
    };
    const maintenance = {
      retryStuckNotifications: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      purgeIdempotencyKeys: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      purgeProcessedOutbox: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
      reclaimStuckEvents: jest.fn(async (..._args: unknown[]) => ({ status: 'completed' })),
    };
    const tenantModel = { findAll: jest.fn(async (..._args: unknown[]) => [{ id: 1 }, { id: 2 }]) };
    const metrics = { recordScheduledJob: jest.fn() };
    const redis = options.redis === undefined ? { set: jest.fn(async (..._args: unknown[]) => 'OK') } : options.redis;
    // El cierre de onboardings abandonados es un job de fondo más; su regla vive en el módulo de
    // onboarding y el planificador solo la agenda.
    const onboardingAbandonment = { markAbandonedFlows: jest.fn(async (..._args: unknown[]) => ({ evaluated: 0, abandoned: 0 })) };
    // El planificador recibe el catálogo ya construido; quién produce cada job es cosa del módulo.
    /*
     * Los tres trabajos nuevos: mora, capacidad de pago y extractos.
     *
     * No estaban porque no existian; sus reglas viven en sus dominios y el planificador solo las
     * agenda. Se simulan aqui porque lo que se prueba es la MECANICA de agendado —liderazgo,
     * reentrada, desfase—, no lo que cada job hace.
     */
    const delinquency = { sweep: jest.fn(async (..._args: unknown[]) => ({ evaluated: 0, enqueued: 0, total: 0, recalculated: 0 })) };
    const creditLineRefresh = {
      refreshStaleLines: jest.fn(async (..._args: unknown[]) => ({ missing: 0, stale: 0, recalculated: 0, failed: 0 })),
    };
    const bankStatements = {
      processPending: jest.fn(async (..._args: unknown[]) => ({ picked: 0, applied: 0, unreadable: 0, failed: 0, breachingSoon: 0 })),
    };
    const scheduledJobs = buildScheduledJobs({
      runtimeJobs: runtimeJobs as never,
      maintenance: maintenance as never,
      onboardingAbandonment: onboardingAbandonment as never,
      delinquency: delinquency as never,
      creditLineRefresh: creditLineRefresh as never,
      bankStatements: bankStatements as never,
    });
    const service = new RuntimeJobsSchedulerService(scheduledJobs, tenantModel as never, redis as never, metrics as never);
    return { service, runtimeJobs, maintenance, onboardingAbandonment, tenantModel, metrics, redis };
  }

  /** Acceso al método privado que ejecuta una tanda, sin esperar al temporizador. */
  const tick = (service: RuntimeJobsSchedulerService, job: { jobCode: string; intervalMs: number; run: (t: string) => Promise<unknown> }) =>
    (service as unknown as { tick: (job: unknown) => Promise<void> }).tick(job);

  const jobsOf = (service: RuntimeJobsSchedulerService) =>
    (service as unknown as { jobs: () => Array<{ jobCode: string; intervalMs: number; run: (t: string) => Promise<unknown> }> }).jobs();

  describe('arranque', () => {
    beforeEach(() => {
      jest.spyOn(global, 'setInterval');
      jest.spyOn(global, 'setTimeout');
    });

    it('no programa nada si el planificador está deshabilitado', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', false);
      const { service } = build();

      service.onApplicationBootstrap();

      expect(setTimeout).not.toHaveBeenCalled();
      expect(setInterval).not.toHaveBeenCalled();
    });

    // El arranque de cada job pasa por un `setTimeout` de desfase antes de armar su `setInterval`:
    // sin ese desfase, N réplicas que arrancan juntas disparan la misma tanda en el mismo instante.
    it('programa los trece jobs cuando está habilitado', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      const { service } = build();

      service.onApplicationBootstrap();

      expect(setTimeout).toHaveBeenCalledTimes(13);
      service.onModuleDestroy();
    });

    it('reparte el primer disparo dentro de la ventana de jitter en vez de dispararlos todos a la vez', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('RUNTIME_JOBS_START_JITTER_MS', 15_000);
      const { service } = build();

      service.onApplicationBootstrap();

      const delays = (setTimeout as unknown as jest.Mock).mock.calls.map((call) => call[1] as number);
      expect(delays).toHaveLength(13);
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(15_000);
      }
      service.onModuleDestroy();
    });

    it('sin jitter configurado el primer disparo es inmediato', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('RUNTIME_JOBS_START_JITTER_MS', 0);
      const { service } = build();

      service.onApplicationBootstrap();

      const delays = (setTimeout as unknown as jest.Mock).mock.calls.map((call) => call[1] as number);
      expect(delays.every((delay) => delay === 0)).toBe(true);
      service.onModuleDestroy();
    });

    it('en producción sin Redis NO arranca: no hay forma de impedir que N instancias procesen el mismo lote', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('NODE_ENV', 'production');
      setEnv('RUNTIME_JOBS_ALLOW_WITHOUT_LOCK', false);
      const { service } = build({ redis: null });

      service.onApplicationBootstrap();

      expect(setTimeout).not.toHaveBeenCalled();
    });

    it('en producción sin Redis arranca si se asume el riesgo explícitamente', () => {
      setEnv('RUNTIME_JOBS_SCHEDULER_ENABLED', true);
      setEnv('NODE_ENV', 'production');
      setEnv('RUNTIME_JOBS_ALLOW_WITHOUT_LOCK', true);
      const { service } = build({ redis: null });

      service.onApplicationBootstrap();

      expect(setTimeout).toHaveBeenCalledTimes(13);
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
      const { service, runtimeJobs, tenantModel } = build({ redis: { set: jest.fn(async (..._args: unknown[]) => null) } });
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);

      expect(tenantModel.findAll).not.toHaveBeenCalled();
      expect(runtimeJobs.processOutbox).not.toHaveBeenCalled();
    });

    it('si Redis falla, se salta la tanda en vez de correr sin lock', async () => {
      const { service, runtimeJobs } = build({
        redis: {
          set: jest.fn(async (..._args: unknown[]) => {
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
        (maintenance.purgeProcessedOutbox as jest.Mock).mock.calls[0][0],
        (maintenance.reclaimStuckEvents as jest.Mock).mock.calls[0][0],
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

    /**
     * `setInterval` dispara pase lo que pase. Si una tanda dura más que su intervalo, la siguiente
     * arrancaba encima: el mismo proceso procesando el mismo lote dos veces en paralelo. El lock de
     * Redis no lo impide (su TTL se acota al intervalo, así que expira justo cuando llega el
     * siguiente tick).
     */
    it('se salta la tanda si la anterior sigue en curso, en vez de solaparse', async () => {
      const { service, runtimeJobs, metrics, redis } = build();
      // Una única promesa compartida por todas las llamadas: la tanda queda en vuelo hasta que la
      // prueba la libera, sin depender de cuántos tenants recorra.
      let release = (): void => {};
      const inFlight = new Promise((resolve) => {
        release = () => resolve({ status: 'completed' });
      });
      (runtimeJobs.processOutbox as jest.Mock).mockImplementation(() => inFlight as never);
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      const first = tick(service, outbox!);
      // Deja correr los microtasks del lock y de la lista de tenants: sin esto la segunda tanda
      // arrancaría antes de que la primera haya llegado siquiera a marcar el job como en vuelo.
      await new Promise((resolve) => setImmediate(resolve));
      await tick(service, outbox!);

      expect(metrics.recordScheduledJob).toHaveBeenCalledWith({ job: 'process_outbox', outcome: 'skipped' });
      // La tanda saltada no llega siquiera a pedir el lock: pedir uno que se va a descartar solo
      // añade carga a Redis.
      expect((redis as { set: jest.Mock }).set).toHaveBeenCalledTimes(1);

      release();
      await first;
    });

    it('liberada la tanda anterior, la siguiente vuelve a ejecutarse con normalidad', async () => {
      const { service, runtimeJobs } = build();
      const outbox = jobsOf(service).find((job) => job.jobCode === 'process_outbox');

      await tick(service, outbox!);
      await tick(service, outbox!);

      // 2 tenants × 2 tandas: el guard no deja residuo que bloquee ejecuciones posteriores.
      expect(runtimeJobs.processOutbox).toHaveBeenCalledTimes(4);
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
