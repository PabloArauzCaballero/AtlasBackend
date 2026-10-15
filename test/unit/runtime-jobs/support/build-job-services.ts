import { DataQualityJobService } from '../../../../src/modules/runtime-jobs/data-quality-job.service.js';
import { OutboxJobsService } from '../../../../src/modules/runtime-jobs/outbox-jobs.service.js';
import { RetentionJobService } from '../../../../src/modules/runtime-jobs/retention-job.service.js';
import { SessionExpiryJobService } from '../../../../src/modules/runtime-jobs/session-expiry-job.service.js';

interface JobServiceDoubles {
  outboxModel: unknown;
  sessionModel: unknown;
  retentionPolicyModel: unknown;
  dataQualityIssueModel: unknown;
  gpsObservationModel: unknown;
  deviceSnapshotModel: unknown;
  formInteractionModel: unknown;
  systemJobRunModel: unknown;
  systemActionLogModel: unknown;
  sequelize: unknown;
  eventsService: unknown;
  jobRuns: unknown;
}

/** Arma los cuatro servicios de jobs de fondo con los mismos dobles y los expone con la API de un solo objeto. */
export function buildJobServices(d: JobServiceDoubles) {
  const outbox = new OutboxJobsService(d.outboxModel as never, d.sequelize as never, d.eventsService as never, d.jobRuns as never);
  const sessions = new SessionExpiryJobService(d.sessionModel as never, d.jobRuns as never);
  const retention = new RetentionJobService(
    d.retentionPolicyModel as never,
    d.gpsObservationModel as never,
    d.deviceSnapshotModel as never,
    d.formInteractionModel as never,
    d.systemJobRunModel as never,
    d.systemActionLogModel as never,
    d.jobRuns as never,
  );
  const dataQuality = new DataQualityJobService(d.dataQualityIssueModel as never, d.jobRuns as never);
  return {
    /** Logger del servicio del outbox: la prueba B12 comprueba el aviso de eventos sin registrar. */
    logger: (outbox as unknown as { logger: object }).logger,
    processOutbox: outbox.processOutbox.bind(outbox),
    processEvents: outbox.processEvents.bind(outbox),
    expireStaleSessions: sessions.expireStaleSessions.bind(sessions),
    applyRetentionPolicies: retention.applyRetentionPolicies.bind(retention),
    recalculateDataQuality: dataQuality.recalculateDataQuality.bind(dataQuality),
  };
}
