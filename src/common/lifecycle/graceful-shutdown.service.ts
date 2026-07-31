/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza evita cortar peticiones en curso durante un despliegue o un reinicio.
 * @system provee infraestructura transversal de ciclo de vida sin introducir reglas de un dominio específico.
 */
import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';

/**
 * Drenado ordenado al recibir `SIGTERM`.
 *
 * Hallazgo A-07 de `docs/audit/auditoria-integral-2026-07-30.md`: `/health/readiness` seguía
 * respondiendo 200 mientras el proceso se apagaba, así que el balanceador le seguía enviando
 * peticiones durante toda la ventana de terminación — cada despliegue tiraba las peticiones que
 * llegaran en ese hueco.
 *
 * La secuencia correcta es: marcar la instancia como NO lista → esperar a que el balanceador lo
 * note (su intervalo de sondeo) → recién entonces cerrar. `beforeApplicationShutdown` es el punto
 * exacto: Nest lo ejecuta ANTES de cerrar los módulos y ESPERA a que la promesa se resuelva, así
 * que la espera de drenado ocurre con la aplicación todavía sirviendo.
 *
 * `SHUTDOWN_DRAIN_MS` debe ser mayor que el intervalo del readiness probe del orquestador
 * (típicamente 5-10 s). Con `0` se desactiva, que es lo correcto en desarrollo y en tests.
 */
@Injectable()
export class GracefulShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private shuttingDown = false;

  /** `true` desde que llega la señal de apagado. Lo consulta el readiness probe. */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    const drainMs = env.SHUTDOWN_DRAIN_MS;

    if (drainMs <= 0) {
      this.logger.log(`Apagado por ${signal ?? 'señal desconocida'}: sin drenado (SHUTDOWN_DRAIN_MS=0).`);
      return;
    }

    this.logger.log(
      `Apagado por ${signal ?? 'señal desconocida'}: readiness pasa a 503 y se espera ${drainMs} ms para que el balanceador retire la instancia.`,
    );
    await new Promise<void>((resolve) => {
      // `unref` para que este temporizador no sea, por sí solo, motivo para mantener vivo el proceso
      // si todo lo demás ya terminó.
      setTimeout(resolve, drainMs).unref();
    });
  }
}
