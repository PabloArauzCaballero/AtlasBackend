import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Cliente Redis compartido del backend.
 *
 * En desarrollo local `REDIS_URL` puede omitirse y los consumidores usan fallback en memoria.
 * En producción `env.ts` exige Redis para que el rate limiting sea distribuido.
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
          // Fail-fast si Redis está caído/inalcanzable en vez de colgar: con enableOfflineQueue=true
          // (default de ioredis) los comandos se ENCOLABAN esperando reconexión indefinidamente, lo
          // que colgaba cualquier request no-@SkipThrottle (el ThrottlerGuard usa Redis) hasta el
          // timeout del cliente. Ahora los comandos rechazan de inmediato y los consumidores (p. ej.
          // RedisThrottlerStorage) degradan con gracia (fail-open). `commandTimeout` cubre el caso de
          // un Redis conectado pero lento. (Hallazgo B4 de la auditoría 2026-07-21.)
          enableOfflineQueue: false,
          connectTimeout: 3000,
          commandTimeout: 1000,
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
