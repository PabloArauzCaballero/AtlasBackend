/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Define los trabajos de fondo de la plataforma (outbox, eventos, sesiones, retención y calidad de datos).
 * @system declara los trabajos programados propios de runtime-jobs, aparte del catálogo general.
 */
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { env } from '../../config/env.js';
import { DataQualityJobService } from './data-quality-job.service.js';
import { OutboxJobsService } from './outbox-jobs.service.js';
import { RetentionJobService } from './retention-job.service.js';
import { SessionExpiryJobService } from './session-expiry-job.service.js';
import type { ScheduledJob } from './scheduled-jobs.catalog.js';

export const SCHEDULER_ACTOR: AuthenticatedUser = { sub: 'runtime-jobs-scheduler', role: 'system' };

/** Ningún job usa `dryRun`: el planificador existe para ejecutar, no para simular. */
export function buildRuntimeScheduledJobs(deps: {
  outboxJobs: OutboxJobsService;
  sessionExpiry: SessionExpiryJobService;
  retention: RetentionJobService;
  dataQuality: DataQualityJobService;
  limit: number;
}): ScheduledJob[] {
  const { outboxJobs, sessionExpiry, retention, dataQuality, limit } = deps;
  return [
    {
      jobCode: 'process_outbox',
      intervalMs: env.RUNTIME_JOBS_OUTBOX_INTERVAL_MS,
      run: (tenantId) => outboxJobs.processOutbox({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'process_events',
      intervalMs: env.RUNTIME_JOBS_EVENTS_INTERVAL_MS,
      run: (tenantId) => outboxJobs.processEvents({ tenantId, body: { limit, dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'expire_stale_sessions',
      intervalMs: env.RUNTIME_JOBS_SESSIONS_INTERVAL_MS,
      run: (tenantId) =>
        sessionExpiry.expireStaleSessions({
          tenantId,
          body: { maxIdleMinutes: env.RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    },
    {
      jobCode: 'apply_retention_policies',
      intervalMs: env.RUNTIME_JOBS_RETENTION_INTERVAL_MS,
      run: (tenantId) => retention.applyRetentionPolicies({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
    {
      jobCode: 'recalculate_data_quality',
      intervalMs: env.RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS,
      run: (tenantId) => dataQuality.recalculateDataQuality({ tenantId, body: { dryRun: false }, currentUser: SCHEDULER_ACTOR }),
    },
  ];
}
