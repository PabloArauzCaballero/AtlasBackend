/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { appRole, runsBackgroundWork } from '../../config/app-role.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { NotificationBroadcastService } from '../notifications/notification-broadcast.service.js';
import { SystemsHealthService } from './systems-health.service.js';

/**
 * Chequeo periódico de las herramientas críticas del catálogo (`SystemsHealthService.
 * getToolsHealth()` — DB, Redis, proveedores externos, etc.) que dispara una notificación in-app
 * real (no un mock) al staff interno cuando una herramienta marcada `isCritical` pasa de
 * saludable a no-saludable, y otra cuando se recupera. Sigue el mismo patrón que
 * `ArchivoLogMongoSyncService` (log-sync): `OnApplicationBootstrap` arranca un `setInterval`,
 * `OnModuleDestroy` lo limpia.
 *
 * Solo dispara en transiciones de estado (no en cada chequeo) para no inundar el inbox de
 * notificaciones con un aviso repetido cada `SYSTEM_HEALTH_MONITOR_INTERVAL_MS` mientras un
 * servicio sigue caído.
 *
 * El último estado conocido por herramienta se respalda en Redis (hash
 * `systems-health:last-known-healthy`): sin eso, un reinicio del backend vaciaba el mapa en
 * memoria y la transición caído→saludable ocurrida durante/tras el reinicio nunca emitía el
 * "Servicio recuperado" (el inbox quedaba con el "Servicio caído" huérfano para siempre). Si no
 * hay cliente Redis (dev sin REDIS_URL) se degrada al comportamiento solo-en-memoria.
 */
@Injectable()
export class SystemsHealthMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly REDIS_STATE_KEY = 'systems-health:last-known-healthy';

  private readonly logger = new Logger(SystemsHealthMonitorService.name);
  private readonly lastKnownHealthy = new Map<string, boolean | null>();
  private timer: NodeJS.Timeout | null = null;
  private checkInFlight: Promise<void> | null = null;
  private persistedStateLoaded = false;

  constructor(
    private readonly healthService: SystemsHealthService,
    private readonly broadcastService: NotificationBroadcastService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  onApplicationBootstrap(): void {
    // Observador GLOBAL de infraestructura, no de esta instancia: corre donde corre el trabajo de
    // fondo. Dejarlo en cada réplica de API multiplicaría los sondeos sin añadir información.
    if (!runsBackgroundWork()) {
      this.logger.log(`Monitor de salud no arrancado: este proceso tiene APP_ROLE=${appRole()} y sólo atiende HTTP.`);
      return;
    }

    if (!env.SYSTEM_HEALTH_MONITOR_ENABLED) {
      this.logger.log('Monitor de salud de herramientas críticas desactivado (SYSTEM_HEALTH_MONITOR_ENABLED=false).');
      return;
    }

    this.logger.log(`Monitor de salud de herramientas críticas habilitado (cada ${env.SYSTEM_HEALTH_MONITOR_INTERVAL_MS}ms).`);
    void this.checkWithLock();
    this.timer = setInterval(() => {
      void this.checkWithLock();
    }, env.SYSTEM_HEALTH_MONITOR_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.checkInFlight;
  }

  private async checkWithLock(): Promise<void> {
    if (this.checkInFlight) return;
    this.checkInFlight = this.checkOnce().finally(() => {
      this.checkInFlight = null;
    });
    await this.checkInFlight;
  }

  private async checkOnce(): Promise<void> {
    await this.loadPersistedState();

    let statuses;
    try {
      statuses = await this.healthService.getToolsHealth();
    } catch (error) {
      this.logger.warn(`No se pudo obtener el estado de salud de herramientas: ${error instanceof Error ? error.message : error}`);
      return;
    }

    for (const status of statuses) {
      if (!status.isCritical) continue;

      const previous = this.lastKnownHealthy.get(status.code);
      const current = status.isHealthy;
      this.lastKnownHealthy.set(status.code, current);
      await this.persistState(status.code, current);

      // Solo interesan transiciones explícitas hacia/desde `false` — `null` (sin probe activo,
      // solo chequeo de configuración) no cuenta como "caído" ni como "recuperado".
      const wentDown = current === false && previous !== false;
      const recovered = current === true && previous === false;
      if (!wentDown && !recovered) continue;

      try {
        if (wentDown) {
          await this.broadcastService.notifyAllInternalUsers(null, {
            title: `Servicio caído: ${status.name}`,
            body: status.healthMessage || `${status.name} (${status.code}) dejó de responder correctamente.`,
            priority: 100,
            category: 'system_alert',
            icon: 'alert-triangle',
          });
        } else {
          await this.broadcastService.notifyAllInternalUsers(null, {
            title: `Servicio recuperado: ${status.name}`,
            body: `${status.name} (${status.code}) volvió a responder correctamente.`,
            priority: 20,
            category: 'system_alert',
            icon: 'check-circle',
          });
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo notificar el cambio de estado de ${status.code} (${wentDown ? 'caído' : 'recuperado'}): ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }

  /** Siembra el mapa en memoria con el estado respaldado en Redis; solo la primera vez. */
  private async loadPersistedState(): Promise<void> {
    if (this.persistedStateLoaded) return;
    this.persistedStateLoaded = true;
    if (!this.redis) return;

    try {
      const stored = await this.redis.hgetall(SystemsHealthMonitorService.REDIS_STATE_KEY);
      for (const [code, value] of Object.entries(stored)) {
        if (this.lastKnownHealthy.has(code)) continue;
        this.lastKnownHealthy.set(code, value === 'true' ? true : value === 'false' ? false : null);
      }
    } catch (error) {
      this.logger.warn(`No se pudo leer el estado de salud respaldado en Redis: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async persistState(code: string, current: boolean | null): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.hset(SystemsHealthMonitorService.REDIS_STATE_KEY, code, String(current));
    } catch (error) {
      this.logger.warn(`No se pudo respaldar en Redis el estado de salud de ${code}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
