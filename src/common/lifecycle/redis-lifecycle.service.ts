/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza evita cortar peticiones en curso durante un despliegue o un reinicio.
 * @system provee infraestructura transversal de ciclo de vida sin introducir reglas de un dominio específico.
 */
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/**
 * Cierra el cliente Redis al apagar.
 *
 * Hallazgo A-07: `RedisModule` crea el cliente en una factory y nadie lo cerraba nunca —
 * `app.enableShutdownHooks()` no puede cerrar lo que ningún provider registró, así que la conexión
 * quedaba viva hasta que el orquestador mataba el proceso. Con `quit()` el servidor Redis libera la
 * conexión de inmediato en vez de esperar a su propio timeout, y el proceso puede terminar por su
 * cuenta en lugar de necesitar `SIGKILL`.
 *
 * `quit()` espera a que los comandos en vuelo terminen; si falla (Redis ya caído), se degrada a
 * `disconnect()`, que corta el socket sin esperar. Apagar nunca debe fallar por esto.
 */
@Injectable()
export class RedisLifecycleService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisLifecycleService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
      this.logger.log('Conexión a Redis cerrada ordenadamente.');
    } catch (error) {
      this.redis.disconnect();
      this.logger.warn(
        `No se pudo cerrar Redis ordenadamente, se cortó la conexión: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
