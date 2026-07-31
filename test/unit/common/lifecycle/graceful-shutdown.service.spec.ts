import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { GracefulShutdownService } from '../../../../src/common/lifecycle/graceful-shutdown.service.js';
import { RedisLifecycleService } from '../../../../src/common/lifecycle/redis-lifecycle.service.js';
import { env } from '../../../../src/config/env.js';

/**
 * Hallazgo A-07 de `docs/audit/auditoria-integral-2026-07-30.md`: al apagar, `/health/readiness`
 * seguía respondiendo 200, así que el balanceador enviaba tráfico a una instancia en terminación —
 * cada despliegue tiraba las peticiones que cayeran en ese hueco. Y el cliente Redis, creado en una
 * factory, no lo cerraba nadie.
 */
describe('ciclo de vida del proceso', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalDrain = mutableEnv.SHUTDOWN_DRAIN_MS;

  afterEach(() => {
    mutableEnv.SHUTDOWN_DRAIN_MS = originalDrain;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('GracefulShutdownService', () => {
    it('arranca sirviendo tráfico', () => {
      expect(new GracefulShutdownService().isShuttingDown()).toBe(false);
    });

    it('sin drenado configurado marca el apagado y devuelve el control de inmediato', async () => {
      mutableEnv.SHUTDOWN_DRAIN_MS = 0;
      const service = new GracefulShutdownService();

      await service.beforeApplicationShutdown('SIGTERM');

      expect(service.isShuttingDown()).toBe(true);
    });

    it('con drenado marca el apagado ANTES de esperar, para que readiness ya responda 503', async () => {
      jest.useFakeTimers();
      mutableEnv.SHUTDOWN_DRAIN_MS = 15_000;
      const service = new GracefulShutdownService();

      const pending = service.beforeApplicationShutdown('SIGTERM');

      // La bandera está puesta aunque la espera siga en curso: ese es todo el punto del drenado.
      expect(service.isShuttingDown()).toBe(true);

      jest.advanceTimersByTime(15_000);
      await expect(pending).resolves.toBeUndefined();
    });
  });

  describe('RedisLifecycleService', () => {
    it('cierra el cliente ordenadamente con quit()', async () => {
      const redis = { quit: jest.fn(async () => 'OK'), disconnect: jest.fn() };

      await new RedisLifecycleService(redis as never).onApplicationShutdown();

      expect(redis.quit).toHaveBeenCalledTimes(1);
      expect(redis.disconnect).not.toHaveBeenCalled();
    });

    it('si quit() falla, corta la conexión y NO propaga el error: apagar no puede fallar por esto', async () => {
      const redis = {
        quit: jest.fn(async () => {
          throw new Error('Connection is closed');
        }),
        disconnect: jest.fn(),
      };

      await expect(new RedisLifecycleService(redis as never).onApplicationShutdown()).resolves.toBeUndefined();
      expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });

    it('sin Redis configurado (desarrollo) no hace nada', async () => {
      await expect(new RedisLifecycleService(null).onApplicationShutdown()).resolves.toBeUndefined();
    });
  });
});
