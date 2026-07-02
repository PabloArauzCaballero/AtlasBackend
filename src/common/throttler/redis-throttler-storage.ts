import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/**
 * `@nestjs/throttler` no reexporta `ThrottlerStorageRecord` desde su punto de entrada público
 * (`export * from './throttler-storage.interface'` en su `index.d.ts` no incluye ese tipo).
 * En vez de importarlo desde una ruta interna de `dist/` (frágil ante cambios de versión), se
 * declara aquí una interfaz estructuralmente idéntica; TypeScript la acepta como compatible con
 * la firma de `ThrottlerStorage.increment` por tipado estructural, sin depender de rutas
 * internas del paquete.
 */
type ThrottlerStorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

/**
 * Implementación de `ThrottlerStorage` (interfaz de `@nestjs/throttler` v6, verificada contra
 * el paquete instalado en este proyecto: `increment(key, ttl, limit, blockDuration, name)` debe
 * devolver `{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }`) respaldada en Redis en
 * vez de en memoria del proceso.
 *
 * Cierra ATLAS-AUDIT-023: con esto, el límite de tasa es el mismo sin importar a cuál de las N
 * instancias del backend llegue cada request, porque el contador vive en Redis (compartido) y
 * no en la memoria de cada proceso Node.
 *
 * Estrategia: contador de ventana fija (`INCR` + `PEXPIRE` solo en el primer hit de la
 * ventana), la misma estrategia que usa la implementación en memoria por defecto de
 * `@nestjs/throttler`. Es un algoritmo simple, predecible y suficiente para proteger
 * endpoints de auth/API — no pretende ser un rate limiter de ventana deslizante de precisión.
 *
 * Uso de bloqueo (`blockDuration`): cuando se excede el límite, se marca `isBlocked=true` y se
 * persiste un TTL de bloqueo separado (`block:<key>`), igual que la semántica que
 * `ThrottlerGuard` espera de esta interfaz.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  isAvailable(): boolean {
    return this.redis !== null;
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      // No debería ocurrir en producción (env.ts exige REDIS_URL), pero si llegara a pasar en
      // un ambiente mal configurado, degradar de forma segura en vez de tirar el request abajo:
      // se reporta "no bloqueado" y se loguea con severidad alta para que salte en observabilidad.
      this.logger.error('RedisThrottlerStorage.increment() llamado sin cliente Redis disponible.');
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }

    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;

    const blockTtlMs = await this.redis.pttl(blockKey);
    if (blockTtlMs > 0) {
      return { totalHits: limit + 1, timeToExpire: 0, isBlocked: true, timeToBlockExpire: Math.ceil(blockTtlMs / 1000) };
    }

    const totalHits = await this.redis.incr(hitKey);
    if (totalHits === 1) {
      await this.redis.pexpire(hitKey, ttl);
    }
    const remainingTtlMs = await this.redis.pttl(hitKey);
    const timeToExpire = remainingTtlMs > 0 ? Math.ceil(remainingTtlMs / 1000) : Math.ceil(ttl / 1000);

    if (totalHits > limit) {
      const effectiveBlockDuration = blockDuration > 0 ? blockDuration : ttl;
      await this.redis.set(blockKey, '1', 'PX', effectiveBlockDuration);
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil(effectiveBlockDuration / 1000) };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
