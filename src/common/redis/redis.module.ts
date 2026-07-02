import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * ATLAS-AUDIT-023 (cerrado en este patch): antes de este módulo, no existía ningún cliente
 * Redis en el proyecto pese a que `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` fija ElastiCache
 * Redis como parte del stack AWS objetivo. Sin Redis, el rate limiting (`@nestjs/throttler`)
 * usaba almacenamiento en memoria del propio proceso: correcto con una sola instancia, pero
 * silenciosamente incorrecto (el límite efectivo se multiplica por el número de instancias)
 * en cuanto se despliega con autoscaling en ECS Fargate.
 *
 * Este módulo expone un único cliente `ioredis` compartido (`REDIS_CLIENT`) para:
 *  - El storage de `ThrottlerModule` (`RedisThrottlerStorage`).
 *  - Cualquier necesidad futura de caché (p. ej. cachear resultados de scoring en Fase 2).
 *
 * Si `REDIS_URL` no está configurado, el factory devuelve `null` y el resto del sistema debe
 * degradar de forma explícita (ver `redis-throttler-storage.ts` y `app.module.ts`), nunca
 * fallar en silencio. En producción, `env.ts` ya exige `REDIS_URL` (ver `superRefine`).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis | null => {
        if (!env.REDIS_URL) {
          return null;
        }
        const client = new Redis(env.REDIS_URL, {
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
        });
        const logger = new Logger('RedisModule');
        client.on('error', (error: Error) => logger.error(`Redis connection error: ${error.message}`));
        client.on('connect', () => logger.log('Conectado a Redis.'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
