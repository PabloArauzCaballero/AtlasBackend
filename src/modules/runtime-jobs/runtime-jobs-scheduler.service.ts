/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { TenantModel } from '../../database/models/index.js';
import { env } from '../../config/env.js';
import { appRole, runsBackgroundWork } from '../../config/app-role.js';
import { JobTickGuard } from './job-tick-guard.js';
import { buildScheduledJobs, type ScheduledJob } from './scheduled-jobs.catalog.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';

/**
 * Ejecuta los trabajos de fondo por su cuenta.
 *
 * Hallazgo A-03 de `docs/audit/auditoria-integral-2026-07-30.md`: los cinco jobs de
 * `RuntimeJobsController` solo existían como endpoints HTTP y no había ningún `@Cron`, `setInterval`
 * ni manifiesto de despliegue que los llamara. En un despliegue real eso significaba que el outbox
 * nunca se despachaba, las sesiones caducadas nunca expiraban y —lo más grave para un backend
 * KYC— las políticas de RETENCIÓN de datos personales nunca se aplicaban.
 *
 * Decisiones:
 *
 * - **Sin dependencia nueva.** Se usa `setInterval`, el mismo mecanismo que ya emplean
 *   `ArchivoLogMongoSyncService` y `SystemsHealthMonitorService`. Estos jobs son "cada N
 *   milisegundos", no necesitan expresiones cron ni el peso de `@nestjs/schedule`.
 * - **Opt-in explícito** (`RUNTIME_JOBS_SCHEDULER_ENABLED`). Un proceso que arranca en un test, en
 *   un script o en una consola de mantenimiento no debe empezar a mutar datos por su cuenta.
 * - **Elección de líder por Redis.** Con varias instancias detrás de un balanceador, todas tienen el
 *   mismo `setInterval`. El lock `SET NX PX` hace que solo una ejecute cada tanda; el resto se salta
 *   el tick sin coste. El lock NO se libera al terminar: expira solo, y así el TTL define además la
 *   cadencia mínima real entre ejecuciones aunque una instancia muera a mitad de job.
 * - **Sin Redis, fail-closed en producción.** Sin lock distribuido no hay forma de impedir que N
 *   instancias procesen el mismo lote a la vez. En desarrollo (una sola instancia) se ejecuta igual;
 *   en producción hace falta `RUNTIME_JOBS_ALLOW_WITHOUT_LOCK=true` para asumirlo a conciencia.
 * - **El lock de liderazgo no basta para evitar el solapamiento.** Su TTL se acota al intervalo del
 *   job para no distorsionar la cadencia, así que expira justo cuando llega el siguiente tick: una
 *   tanda más lenta que su intervalo se solaparía consigo misma. Eso lo cubre `JobTickGuard`, que
 *   además convierte una tanda atascada en una señal alertable en vez de en silencio.
 * - **Arranque desfasado.** El primer tick de cada job se reparte dentro de una ventana aleatoria
 *   para que N réplicas que arrancan juntas no golpeen Redis y Postgres en el mismo instante.
 *
 * QUÉ se ejecuta y cada cuánto vive en `scheduled-jobs.catalog.ts`: esa lista cambia con cada
 * trabajo de fondo nuevo, mientras que las garantías de concurrencia de este archivo casi nunca.
 */
@Injectable()
export class RuntimeJobsSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeJobsSchedulerService.name);
  private readonly instanceId = randomUUID();
  private readonly timers: NodeJS.Timeout[] = [];
  private stopped = false;

  /**
   * Impide que una tanda se solape consigo misma y avisa cuando una se atasca. Ver `JobTickGuard`
   * para el porqué de cada decisión; aquí solo se conecta el aviso a las métricas y al log.
   */
  private readonly tickGuard = new JobTickGuard({
    timeoutMs: env.RUNTIME_JOBS_TICK_TIMEOUT_MS,
    onStall: ({ jobCode, elapsedMs }) => {
      this.metrics?.recordScheduledJob({ job: jobCode, outcome: 'stalled' });
      this.logger.error(
        `Job ${jobCode} ATASCADO: la tanda lleva ${elapsedMs} ms, por encima de RUNTIME_JOBS_TICK_TIMEOUT_MS ` +
          `(${env.RUNTIME_JOBS_TICK_TIMEOUT_MS} ms). El job no volverá a ejecutarse hasta que termine: revisa consultas ` +
          'bloqueadas y proveedores externos sin respuesta antes de reiniciar el proceso.',
      );
    },
  });

  constructor(
    private readonly runtimeJobs: RuntimeJobsService,
    private readonly maintenance: RuntimeMaintenanceJobsService,
    @InjectModel(TenantModel) private readonly tenantModel: typeof TenantModel,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private jobs(): ScheduledJob[] {
    return buildScheduledJobs({ runtimeJobs: this.runtimeJobs, maintenance: this.maintenance });
  }

  onApplicationBootstrap(): void {
    if (!runsBackgroundWork()) {
      this.logger.log(`Planificador de trabajos no arrancado: este proceso tiene APP_ROLE=${appRole()} y sólo atiende HTTP.`);
      return;
    }

    if (!env.RUNTIME_JOBS_SCHEDULER_ENABLED) {
      this.logger.log('Planificador de trabajos deshabilitado (RUNTIME_JOBS_SCHEDULER_ENABLED=false). Los jobs solo corren por HTTP.');
      return;
    }

    if (!this.redis && env.NODE_ENV === 'production' && !env.RUNTIME_JOBS_ALLOW_WITHOUT_LOCK) {
      this.logger.error(
        'Planificador de trabajos NO arrancado: en producción hace falta Redis para la elección de líder, ' +
          'o RUNTIME_JOBS_ALLOW_WITHOUT_LOCK=true si se asume el riesgo de que varias instancias procesen el mismo lote.',
      );
      return;
    }

    for (const job of this.jobs()) this.schedule(job);
  }

  /**
   * Programa un job con un desfase inicial aleatorio.
   *
   * Sin el desfase, N réplicas que arrancan juntas tras un despliegue disparan el mismo tick en el
   * mismo instante: todas piden el mismo lock a Redis y todas leen la lista de tenants a la vez.
   * Es un pico sincronizado (thundering herd) sobre las dos dependencias más críticas, justo en el
   * minuto en que el servicio está menos asentado. El desfase lo reparte y no cambia la cadencia:
   * solo mueve el punto de partida de cada serie.
   */
  private schedule(job: ScheduledJob): void {
    const jitterMs = env.RUNTIME_JOBS_START_JITTER_MS > 0 ? Math.floor(Math.random() * env.RUNTIME_JOBS_START_JITTER_MS) : 0;

    const startTimer = setTimeout(() => {
      if (this.stopped) return;
      void this.tick(job);
      const interval = setInterval(() => void this.tick(job), job.intervalMs);
      // `unref` para que un proceso que solo espera a estos timers pueda terminar (scripts, tests).
      interval.unref();
      this.timers.push(interval);
    }, jitterMs);
    startTimer.unref();
    this.timers.push(startTimer);

    this.logger.log(`Job ${job.jobCode} programado cada ${job.intervalMs} ms (primer disparo en ${jitterMs} ms).`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    // `clearInterval` y `clearTimeout` son el mismo cierre en Node: la lista mezcla los temporizadores
    // de arranque (con desfase) y los periódicos, y ambos se cancelan igual.
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  /**
   * Una tanda, protegida contra el solapamiento consigo misma (ver `JobTickGuard`).
   *
   * El orden importa: el guard de reentrada va ANTES de pedir el liderazgo. Si la tanda anterior
   * sigue viva, esta no debe ni consultar a Redis — pedir un lock que se va a descartar solo añade
   * carga a la dependencia y ruido a las métricas.
   */
  private async tick(job: ScheduledJob): Promise<void> {
    if (this.stopped) return;

    const outcome = await this.tickGuard.run(job.jobCode, () => this.runBatch(job));
    if (outcome === 'skipped_overlap') {
      this.metrics?.recordScheduledJob({ job: job.jobCode, outcome: 'skipped' });
      this.logger.warn(
        `Job ${job.jobCode}: se salta esta tanda porque la anterior sigue en curso ` +
          `(${this.tickGuard.runningForMs(job.jobCode) ?? 0} ms). Si se repite, el intervalo es más corto que la duración real del job.`,
      );
    }
  }

  /**
   * El trabajo en sí: intenta ser líder de este job y, si lo consigue, lo corre para cada tenant
   * activo. Los tenants se recorren en serie a propósito — son jobs de fondo, no hay prisa, y en
   * paralelo competirían por el mismo pool de conexiones que atiende el tráfico HTTP.
   */
  private async runBatch(job: ScheduledJob): Promise<void> {
    const leader = await this.acquireLeadership(job);
    if (!leader) return;

    try {
      const tenantIds = await this.listActiveTenantIds();
      for (const tenantId of tenantIds) {
        if (this.stopped) return;
        try {
          await job.run(tenantId);
          this.metrics?.recordScheduledJob({ job: job.jobCode, outcome: 'success' });
        } catch (error) {
          this.metrics?.recordScheduledJob({ job: job.jobCode, outcome: 'failure' });
          // Un tenant que falla no puede cancelar a los demás: cada uno tiene su propia fila en
          // `system_job_runs` con el error, que es donde se investiga.
          this.logger.error(
            `Job ${job.jobCode} falló para el tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.metrics?.recordScheduledJob({ job: job.jobCode, outcome: 'failure' });
      this.logger.error(
        `No se pudo ejecutar la tanda de ${job.jobCode}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * `SET clave instancia NX PX ttl`: atómico, así que exactamente una instancia lo consigue. El TTL
   * se acota al intervalo del job para que la cadencia no se distorsione, y a un techo configurable
   * para que un job diario no deje un lock de 24 h si la instancia líder muere.
   */
  private async acquireLeadership(job: ScheduledJob): Promise<boolean> {
    if (!this.redis) return true;

    const ttlMs = Math.min(job.intervalMs, env.RUNTIME_JOBS_LEADER_LOCK_TTL_MS);
    try {
      const acquired = await this.redis.set(`atlas:jobs:leader:${job.jobCode}`, this.instanceId, 'PX', ttlMs, 'NX');
      return acquired === 'OK';
    } catch (error) {
      // Redis caído: se salta la tanda en vez de correr sin lock. Perder una ejecución de un job
      // idempotente es reversible; procesar el mismo lote desde N instancias, no siempre.
      this.logger.warn(
        `No se pudo tomar el liderazgo de ${job.jobCode} (Redis): ${error instanceof Error ? error.message : String(error)}. Se salta la tanda.`,
      );
      return false;
    }
  }

  private async listActiveTenantIds(): Promise<string[]> {
    const rows = await this.tenantModel.findAll({
      where: { deleted: { [Op.ne]: true }, [Op.or]: [{ status: null }, { status: { [Op.ne]: 'inactive' } }] } as never,
      attributes: ['id'],
    });
    return rows.map((row) => String(row.id));
  }
}
