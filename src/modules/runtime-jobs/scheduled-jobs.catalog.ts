/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza define qué trabajo de fondo corre solo y con qué frecuencia.
 * @system declara el catálogo de trabajos programados que ejecuta el planificador.
 */
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { env } from '../../config/env.js';
import { OnboardingAbandonmentService } from '../customer-onboarding/application/onboarding-abandonment.service.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';

/**
 * Actor con el que se registran las ejecuciones automáticas en `system_job_runs` y en la auditoría.
 * `role: 'system'` es el mismo rol que ya autoriza el controller para disparos máquina-a-máquina, y
 * `sub` deja rastro de que el disparo vino del planificador y no de un operador.
 */
export const SCHEDULER_ACTOR: AuthenticatedUser = { sub: 'runtime-jobs-scheduler', role: 'system' };

/**
 * Token de inyección del catálogo ya construido.
 *
 * El planificador recibe la LISTA, no los servicios que la producen: así deja de crecer un
 * parámetro por cada trabajo de fondo nuevo y no vuelve a tocarse el archivo donde viven las
 * garantías de concurrencia.
 */
export const SCHEDULED_JOBS = Symbol('SCHEDULED_JOBS');

export type ScheduledJob = {
  jobCode: string;
  intervalMs: number;
  run: (tenantId: string) => Promise<unknown>;
};

/**
 * QUÉ se ejecuta solo y CADA CUÁNTO, separado de CÓMO se ejecuta (`RuntimeJobsSchedulerService`).
 *
 * La separación no es solo por tamaño: esta lista es declarativa y cambia cada vez que aparece un
 * trabajo de fondo nuevo, mientras que la mecánica de ejecución —liderazgo, reentrada, watchdog,
 * apagado— cambia por motivos completamente distintos y mucho más raros. Mezclarlas hacía que cada
 * job nuevo tocara el archivo donde viven las garantías de concurrencia.
 *
 * Ningún job usa `dryRun`: los DTO lo traen en `true` por defecto para proteger el disparo manual
 * desde HTTP, y aquí se pasa `false` explícito porque la razón de ser del planificador es ejecutar.
 */
export function buildScheduledJobs(deps: {
  runtimeJobs: RuntimeJobsService;
  maintenance: RuntimeMaintenanceJobsService;
  onboardingAbandonment: OnboardingAbandonmentService;
}): ScheduledJob[] {
  const limit = env.RUNTIME_JOBS_BATCH_LIMIT;
  const { runtimeJobs, maintenance, onboardingAbandonment } = deps;

  return [
    {
      jobCode: 'process_outbox',
      intervalMs: env.RUNTIME_JOBS_OUTBOX_INTERVAL_MS,
      run: (tenantId) => runtimeJobs.processOutbox({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'process_events',
      intervalMs: env.RUNTIME_JOBS_EVENTS_INTERVAL_MS,
      run: (tenantId) => runtimeJobs.processEvents({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'expire_stale_sessions',
      intervalMs: env.RUNTIME_JOBS_SESSIONS_INTERVAL_MS,
      run: (tenantId) =>
        runtimeJobs.expireStaleSessions({
          tenantId,
          body: { maxIdleMinutes: env.RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    },
    {
      jobCode: 'apply_retention_policies',
      intervalMs: env.RUNTIME_JOBS_RETENTION_INTERVAL_MS,
      run: (tenantId) => runtimeJobs.applyRetentionPolicies({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'retry_stuck_notifications',
      intervalMs: env.RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS,
      run: (tenantId) =>
        maintenance.retryStuckNotifications({
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
              maintenance.deliverPendingNotifications({
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
        maintenance.purgeIdempotencyKeys({
          tenantId,
          body: { retentionDays: env.RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS, limit: 1_000, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    },
    // ATLAS-DATA-003: el outbox drenado seguía acumulando filas `processed` para siempre. Corre con
    // la misma cadencia que la purga de idempotencia porque responde al mismo problema —evidencia
    // operativa que deja de serlo pasado su período de retención— y comparte su ventana.
    {
      jobCode: 'purge_processed_outbox',
      intervalMs: env.RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS,
      run: (tenantId) =>
        maintenance.purgeProcessedOutbox({
          tenantId,
          body: { retentionDays: env.RUNTIME_JOBS_OUTBOX_RETENTION_DAYS, limit: 1_000, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    },
    // Cierre del otro extremo del embudo. El envío del paquete ya cierra los flujos completados;
    // sin este job `completion_status` se quedaba en `in_progress` para siempre y `abandoned_at` en
    // `null`, así que la tasa de abandono —la métrica que dice si el registro funciona— no existía.
    // Solo estaba expuesto como endpoint HTTP: nadie lo llamaba.
    {
      jobCode: 'mark_abandoned_onboardings',
      intervalMs: env.RUNTIME_JOBS_ONBOARDING_ABANDONMENT_INTERVAL_MS,
      run: (tenantId) =>
        onboardingAbandonment.markAbandonedFlows({
          tenantId,
          olderThanDays: env.RUNTIME_JOBS_ONBOARDING_ABANDONMENT_DAYS,
          limit,
        }),
    },
    {
      jobCode: 'recalculate_data_quality',
      intervalMs: env.RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS,
      run: (tenantId) => runtimeJobs.recalculateDataQuality({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    // Rescate de los eventos que `process_events` reclamó y no llegó a resolver porque el proceso
    // murió a la mitad. Sin este job esos eventos quedan en `processing` para siempre: ninguna
    // consulta de reclamo los mira, así que se pierden en silencio.
    {
      jobCode: 'reclaim_stuck_events',
      intervalMs: env.RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS,
      run: (tenantId) =>
        maintenance.reclaimStuckEvents({
          tenantId,
          body: { olderThanMinutes: env.RUNTIME_JOBS_STUCK_EVENT_MINUTES, limit, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    },
  ];
}
