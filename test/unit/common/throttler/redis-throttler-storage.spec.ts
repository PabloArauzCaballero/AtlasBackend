import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { RedisThrottlerStorage } from '../../../../src/common/throttler/redis-throttler-storage.js';

/**
 * El rate limit distribuido es columna vertebral de seguridad. Estos tests fijan el contrato que
 * `ThrottlerGuard` espera de la interfaz `ThrottlerStorage`.
 *
 * Se usa un doble de Redis en vez de un Redis real: lo que se verifica aquí es el ALGORITMO de
 * ventana fija y la semántica de bloqueo, no ioredis.
 */

type FakeRedis = {
  pttl: jest.Mock;
  incr: jest.Mock;
  pexpire: jest.Mock;
  set: jest.Mock;
};

function buildRedis(overrides: Partial<Record<keyof FakeRedis, unknown>> = {}): FakeRedis {
  return {
    // Por defecto: no hay bloqueo activo (pttl < 0 significa "sin TTL/clave").
    pttl: jest.fn(async () => -2),
    incr: jest.fn(async () => 1),
    pexpire: jest.fn(async () => 1),
    set: jest.fn(async () => 'OK'),
    ...overrides,
  } as FakeRedis;
}

function buildStorage(redis: FakeRedis | null): RedisThrottlerStorage {
  return new RedisThrottlerStorage(redis as never);
}

describe('RedisThrottlerStorage', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = buildRedis();
  });

  describe('disponibilidad', () => {
    it('isAvailable refleja si hay cliente Redis', () => {
      expect(buildStorage(redis).isAvailable()).toBe(true);
      expect(buildStorage(null).isAvailable()).toBe(false);
    });

    it('sin Redis degrada de forma segura: no lanza y NO bloquea el request', async () => {
      const result = await buildStorage(null).increment('ip:1', 60_000, 10, 0, 'default');
      expect(result).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
    });
  });

  describe('ventana fija', () => {
    it('en el primer hit incrementa y fija el TTL de la ventana', async () => {
      redis.incr.mockResolvedValue(1 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(60_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 0, 'default');

      expect(redis.incr).toHaveBeenCalledWith('throttle:default:ip:1');
      expect(redis.pexpire).toHaveBeenCalledWith('throttle:default:ip:1', 60_000);
      expect(result).toMatchObject({ totalHits: 1, isBlocked: false, timeToExpire: 60 });
    });

    it('en hits posteriores NO reinicia el TTL (si no, la ventana nunca cerraría)', async () => {
      redis.incr.mockResolvedValue(3 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(45_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 0, 'default');

      expect(redis.pexpire).not.toHaveBeenCalled();
      expect(result).toMatchObject({ totalHits: 3, isBlocked: false, timeToExpire: 45 });
    });

    it('si el TTL restante no es válido, cae al ttl declarado', async () => {
      redis.incr.mockResolvedValue(2 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(-1 as never);

      const result = await buildStorage(redis).increment('ip:1', 30_000, 10, 0, 'default');

      expect(result.timeToExpire).toBe(30);
    });

    it('el contador está namespaciado por throttler: dos throttlers no comparten cuota', async () => {
      const storage = buildStorage(redis);
      await storage.increment('ip:1', 60_000, 10, 0, 'login');
      await storage.increment('ip:1', 60_000, 10, 0, 'default');

      expect(redis.incr).toHaveBeenNthCalledWith(1, 'throttle:login:ip:1');
      expect(redis.incr).toHaveBeenNthCalledWith(2, 'throttle:default:ip:1');
    });
  });

  describe('bloqueo al exceder el límite', () => {
    it('al pasar el límite marca isBlocked y persiste el bloqueo con blockDuration', async () => {
      redis.incr.mockResolvedValue(11 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(5_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 120_000, 'default');

      expect(redis.set).toHaveBeenCalledWith('throttle-block:default:ip:1', '1', 'PX', 120_000);
      expect(result).toMatchObject({ totalHits: 11, isBlocked: true, timeToBlockExpire: 120 });
    });

    it('si blockDuration es 0, el bloqueo dura lo que la ventana', async () => {
      redis.incr.mockResolvedValue(11 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(5_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 0, 'default');

      expect(redis.set).toHaveBeenCalledWith('throttle-block:default:ip:1', '1', 'PX', 60_000);
      expect(result.timeToBlockExpire).toBe(60);
    });

    it('exactamente en el límite todavía NO bloquea', async () => {
      redis.incr.mockResolvedValue(10 as never);
      redis.pttl.mockResolvedValueOnce(-2 as never).mockResolvedValueOnce(5_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 0, 'default');

      expect(result.isBlocked).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('con un bloqueo ya activo responde bloqueado SIN consumir un hit más', async () => {
      redis.pttl.mockResolvedValueOnce(30_000 as never);

      const result = await buildStorage(redis).increment('ip:1', 60_000, 10, 0, 'default');

      expect(redis.incr).not.toHaveBeenCalled();
      expect(result).toEqual({ totalHits: 11, timeToExpire: 0, isBlocked: true, timeToBlockExpire: 30 });
    });
  });
});
