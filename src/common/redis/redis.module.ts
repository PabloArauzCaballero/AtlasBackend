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
