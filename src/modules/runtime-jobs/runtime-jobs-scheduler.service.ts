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
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { env } from '../../config/env.js';
import { appRole, runsBackgroundWork } from '../../config/app-role.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';

/**
 * Actor con el que se registran las ejecuciones automáticas en `system_job_runs` y en la auditoría.
 * `role: 'system'` es el mismo rol que ya autoriza el controller para disparos máquina-a-máquina, y
 * `sub` deja rastro de que el disparo vino del planificador y no de un operador.
 */
const SCHEDULER_ACTOR: AuthenticatedUser = { sub: 'runtime-jobs-scheduler', role: 'system' };

type ScheduledJob = {
  jobCode: string;
  intervalMs: number;
  run: (tenantId: string) => Promise<unknown>;
};

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
 * - **Nunca `dryRun`.** Los DTO tienen `dryRun: true` por defecto para proteger el disparo manual;
 *   el planificador pasa `false` explícito porque su razón de ser es ejecutar.
 */
@Injectable()
export class RuntimeJobsSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeJobsSchedulerService.name);
  private readonly instanceId = randomUUID();
  private readonly timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(
    private readonly runtimeJobs: RuntimeJobsService,
    private readonly maintenance: RuntimeMaintenanceJobsService,
    @InjectModel(TenantModel) private readonly tenantModel: typeof TenantModel,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private jobs(): ScheduledJob[] {
    const limit = env.RUNTIME_JOBS_BATCH_LIMIT;
    return [
      {
        jobCode: 'process_outbox',
        intervalMs: env.RUNTIME_JOBS_OUTBOX_INTERVAL_MS,
        run: (tenantId) => this.runtimeJobs.processOutbox({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
      },
      {
        jobCode: 'process_events',
        intervalMs: env.RUNTIME_JOBS_EVENTS_INTERVAL_MS,
        run: (tenantId) => this.runtimeJobs.processEvents({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
      },
      {
        jobCode: 'expire_stale_sessions',
        intervalMs: env.RUNTIME_JOBS_SESSIONS_INTERVAL_MS,
        run: (tenantId) =>
          this.runtimeJobs.expireStaleSessions({
            tenantId,
            body: { maxIdleMinutes: env.RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES, dryRun: false },
            currentUser: SCHEDULER_ACTOR,
          }),
      },
      {
        jobCode: 'apply_retention_policies',
        intervalMs: env.RUNTIME_JOBS_RETENTION_INTERVAL_MS,
        run: (tenantId) => this.runtimeJobs.applyRetentionPolicies({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
      },
      {
        jobCode: 'retry_stuck_notifications',
        intervalMs: env.RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS,
        run: (tenantId) =>
          this.maintenance.retryStuckNotifications({
            tenantId,
            body: { olderThanMinutes: env.RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES, limit, dryRun: false },
            currentUser: SCHEDULER_ACTOR,
          }),
      },
      // Sólo tiene sentido cuando la API NO entrega dentro del request: si la entrega es `inline`,
      // este job competiría por los mismos mensajes que el proceso que acaba de crearlos.
      ...(env.NOTIFICATIONS_DELIVERY_MODE === 'deferred'
        ? [
            {
              jobCode: 'deliver_pending_notifications',
              intervalMs: env.RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS,
              run: (tenantId: string) =>
                this.maintenance.deliverPendingNotifications({
                  tenantId,
                  body: { limit, dryRun: false },
                  currentUser: SCHEDULER_ACTOR,
                }),
            },
          ]
        : []),
      {
        jobCode: 'purge_idempotency_keys',
        intervalMs: env.RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS,
        run: (tenantId) =>
          this.maintenance.purgeIdempotencyKeys({
            tenantId,
            body: { retentionDays: env.RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS, limit: 1_000, dryRun: false },
            currentUser: SCHEDULER_ACTOR,
          }),
      },
      {
        jobCode: 'recalculate_data_quality',
        intervalMs: env.RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS,
        run: (tenantId) => this.runtimeJobs.recalculateDataQuality({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
      },
    ];
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

    for (const job of this.jobs()) {
      const timer = setInterval(() => void this.tick(job), job.intervalMs);
      // `unref` para que un proceso que solo espera a estos timers pueda terminar (scripts, tests).
      timer.unref();
      this.timers.push(timer);
      this.logger.log(`Job ${job.jobCode} programado cada ${job.intervalMs} ms.`);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  /**
   * Una tanda: intenta ser líder de este job y, si lo consigue, lo corre para cada tenant activo.
   * Los tenants se recorren en serie a propósito — son jobs de fondo, no hay prisa, y en paralelo
   * competirían por el mismo pool de conexiones que atiende el tráfico HTTP.
   */
  private async tick(job: ScheduledJob): Promise<void> {
    if (this.stopped) return;

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
