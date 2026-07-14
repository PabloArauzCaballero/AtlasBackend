import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import {
  AddressGpsObservationModel,
  CustomerSessionModel,
  DataQualityIssueModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  OperationalAuditLogModel,
  OutboxEventModel,
  RetentionPolicyModel,
  SystemJobRunModel,
} from '../../database/models/index.js';
import { listEventDefinitions } from '../events/event-registry.js';
import { EventsService } from '../events/events.service.js';
import {
  ApplyRetentionPoliciesDto,
  ExpireStaleSessionsDto,
  ProcessEventsDto,
  ProcessOutboxDto,
  RecalculateDataQualityDto,
} from './runtime-jobs.schemas.js';

function registeredEventCodesOrSentinel(): string[] {
  const codes = listEventDefinitions().map((event) => event.code);
  // `NOT IN (:codes)` con un arreglo vacío es SQL inválido; un valor centinela que nunca
  // coincide con un event_code real preserva la semántica "excluir ninguno" de forma segura.
  return codes.length > 0 ? codes : ['__no_registered_events__'];
}

type RetentionOutcome = { table: string; action: 'delete' | 'anonymize'; affected: number };

/**
 * ATLAS-AUDIT-024 (cerrado parcialmente en este patch): antes de este cambio,
 * `applyRetentionPolicies` era un stub que solo contaba políticas activas y siempre devolvía
 * `destructiveActionsExecuted: 0`, sin importar el valor real de `dryRun`.
 *
 * Este registro mapea `policy_code` (columna de `retention_policies`) a una acción ejecutable
 * real. A propósito, solo se registran tablas de telemetría cruda claramente no-financieras y
 * no-auditables (GPS, snapshots de dispositivo, interacción de formularios) — nunca tablas de
 * decisión/auditoría (`risk_assessment_results`, `operational_audit_logs`, etc.), que deben
 * seguir siendo append-only según `BACKEND_DEVELOPMENT_CONTEXT.md` §8 y §11.
 *
 * La única política ya sembrada en `db/seeders` (`risk-data-365d`, `applies_to:
 * risk_and_fraud_testing`) NO tiene una tabla mapeada aquí a propósito: su alcance real
 * ("datos de riesgo y fraude") es ambiguo y podría incluir tablas de decisión que no deben
 * purgarse — cerrar esa ambigüedad es una decisión de producto/legal, no algo que este patch
 * deba inventar (ver PENDIENTE_ATLAS en docs/pending/pending-items.md). Para esa política, el
 * job sigue reportando `destructiveActionsExecuted: 0`, tal como antes, pero ahora por una
 * razón explícita y visible en la respuesta (`unmappedPolicies`), no por ser un stub general.
 *
 * Para activar la purga real de las 3 tablas mapeadas aquí, un operador debe crear/activar una
 * fila en `retention_policies` con uno de estos `policy_code`. Mientras no exista esa fila
 * activa, el comportamiento observable sigue siendo "no se ejecuta nada" — igual que antes.
 */
const RETENTION_TARGETS: Record<string, { table: string; description: string }> = {
  gps_observations_90d: {
    table: 'address_gps_observations',
    description: 'Purga GPS crudo de onboarding/direcciones tras el período de retención.',
  },
  device_snapshots_90d: {
    table: 'device_snapshots',
    description: 'Anonimiza snapshots de dispositivo (marca/modelo/versión) conservando señales de riesgo agregadas (root/emulador/VPN).',
  },
  form_interaction_events_60d: {
    table: 'form_field_interaction_events',
    description: 'Purga eventos crudos de interacción de formularios de onboarding.',
  },
};

@Injectable()
export class RuntimeJobsService {
  private readonly logger = new Logger(RuntimeJobsService.name);

  constructor(
    @InjectModel(SystemJobRunModel) private readonly jobRunModel: typeof SystemJobRunModel,
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
    @InjectModel(CustomerSessionModel) private readonly sessionModel: typeof CustomerSessionModel,
    @InjectModel(RetentionPolicyModel) private readonly retentionPolicyModel: typeof RetentionPolicyModel,
    @InjectModel(DataQualityIssueModel) private readonly dataQualityIssueModel: typeof DataQualityIssueModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(AddressGpsObservationModel) private readonly gpsObservationModel: typeof AddressGpsObservationModel,
    @InjectModel(DeviceSnapshotModel) private readonly deviceSnapshotModel: typeof DeviceSnapshotModel,
    @InjectModel(FormFieldInteractionEventModel) private readonly formInteractionModel: typeof FormFieldInteractionEventModel,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly eventsService: EventsService,
  ) {}

  private async executeRetentionTarget(policyCode: string, cutoffDate: Date, dryRun: boolean): Promise<RetentionOutcome | null> {
    const target = RETENTION_TARGETS[policyCode];
    if (!target) {
      return null;
    }

    if (policyCode === 'gps_observations_90d') {
      const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
      const affected = dryRun ? await this.gpsObservationModel.count({ where }) : await this.gpsObservationModel.destroy({ where });
      return { table: target.table, action: 'delete', affected };
    }

    if (policyCode === 'device_snapshots_90d') {
      const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
      if (dryRun) {
        const affected = await this.deviceSnapshotModel.count({ where });
        return { table: target.table, action: 'anonymize', affected };
      }
      const [affected] = await this.deviceSnapshotModel.update(
        {
          brand: null,
          model: null,
          osVersion: null,
          appVersion: null,
          // Se conservan deliberadamente: isRooted, isEmulator, vpnDetected, osFamily,
          // deviceTierSnapshot — señales de riesgo agregadas sin valor identificatorio directo.
        } as never,
        { where },
      );
      return { table: target.table, action: 'anonymize', affected };
    }

    if (policyCode === 'form_interaction_events_60d') {
      const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
      const affected = dryRun ? await this.formInteractionModel.count({ where }) : await this.formInteractionModel.destroy({ where });
      return { table: target.table, action: 'delete', affected };
    }

    // No debería alcanzarse: todo policyCode presente en RETENTION_TARGETS debe tener una rama
    // arriba. Se deja como red de seguridad explícita en vez de un `else` silencioso.
    this.logger.warn(`RETENTION_TARGETS tiene "${policyCode}" registrado pero sin lógica de ejecución implementada.`);
    return null;
  }

  /**
   * ATLAS-AUDIT-022 (cerrado en este patch): antes de este cambio, este método hacía un
   * `SELECT` normal seguido de un `for` que llamaba `.save()` fila por fila, sin ningún bloqueo.
   * Si dos ejecuciones de este job corrían casi al mismo tiempo (un reintento de un scheduler
   * externo, un operador disparándolo a mano mientras el cron también corre, o más de una tarea
   * de ECS Fargate con el mismo cron configurado), ambas podían leer el mismo lote de eventos
   * "pendientes" antes de que ninguna los marcara como procesados, duplicando su procesamiento.
   *
   * La corrección reutiliza exactamente el mismo patrón ya usado (correctamente) en
   * `events.repository.ts::claimPending` para eventos de negocio: `SELECT ... FOR UPDATE SKIP
   * LOCKED` dentro de una transacción, seguido de un `UPDATE` atómico sobre las filas
   * reclamadas. Dos ejecuciones concurrentes ahora se reparten las filas sin solaparse, en vez
   * de reprocesar las mismas.
   */
  async processOutbox(input: { tenantId: string; body: ProcessOutboxDto; currentUser: AuthenticatedUser }) {
    return this.runJob(
      { tenantId: input.tenantId, jobCode: 'process_outbox', body: input.body, currentUser: input.currentUser },
      async () => {
        const excludedCodes = registeredEventCodesOrSentinel();

        if (input.body.dryRun) {
          // Modo solo-lectura: no hay ninguna escritura que proteger con bloqueo de fila, un
          // `SELECT` simple es seguro y suficiente para reportar cuántas filas serían afectadas.
          const [{ count }] = await this.sequelize.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM outbox_events
             WHERE status = 'pending'
               AND _tenant_id = CAST(:tenantId AS BIGINT)
               AND COALESCE(available_at, now()) <= now()
               AND event_code NOT IN (:excludedCodes)`,
            { replacements: { tenantId: input.tenantId, excludedCodes }, type: QueryTypes.SELECT },
          );
          const totalPending = await this.outboxModel.count({
            where: { tenantId: input.tenantId, status: 'pending', availableAt: { [Op.lte]: new Date() } } as never,
          });
          const selected = Math.min(Number(count), input.body.limit);
          return {
            selected,
            processed: 0,
            skippedBusinessEvents: totalPending - Number(count),
            dryRun: true,
            note: 'process-outbox conserva compatibilidad y no procesa eventos de negocio registrados; usa process-events para notificaciones.',
          };
        }

        const now = new Date();
        const claimed = await this.sequelize.transaction(async (transaction) => {
          const rows = await this.sequelize.query<{ id: string }>(
            `WITH candidates AS (
             SELECT _id
             FROM outbox_events
             WHERE status = 'pending'
               AND _tenant_id = CAST(:tenantId AS BIGINT)
               AND COALESCE(available_at, now()) <= now()
               AND event_code NOT IN (:excludedCodes)
             ORDER BY COALESCE(available_at, now()) ASC, _id ASC
             LIMIT :limit
             FOR UPDATE SKIP LOCKED
           )
           UPDATE outbox_events AS event
           SET status = 'processed',
               attempts = COALESCE(event.attempts, 0) + 1,
               processed_at = :now,
               _updated_at = :now
           FROM candidates
           WHERE event._id = candidates._id
           RETURNING event._id AS id;`,
            {
              replacements: { tenantId: input.tenantId, excludedCodes, limit: input.body.limit, now },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          return rows;
        });

        const totalPendingAfter = await this.outboxModel.count({
          where: { tenantId: input.tenantId, status: 'pending', availableAt: { [Op.lte]: new Date() } } as never,
        });

        return {
          selected: claimed.length,
          processed: claimed.length,
          skippedBusinessEvents: totalPendingAfter,
          dryRun: false,
          note: 'process-outbox conserva compatibilidad y no procesa eventos de negocio registrados; usa process-events para notificaciones.',
        };
      },
    );
  }

  async processEvents(input: { tenantId: string; body: ProcessEventsDto; currentUser: AuthenticatedUser }) {
    return this.runJob(
      { tenantId: input.tenantId, jobCode: 'process_events', body: input.body, currentUser: input.currentUser },
      async () => {
        return this.eventsService.processPendingEvents({
          tenantId: input.tenantId,
          limit: input.body.limit,
          dryRun: input.body.dryRun,
          workerId: 'runtime_jobs_process_events',
        });
      },
    );
  }

  async expireStaleSessions(input: { tenantId: string; body: ExpireStaleSessionsDto; currentUser: AuthenticatedUser }) {
    return this.runJob(
      { tenantId: input.tenantId, jobCode: 'expire_stale_sessions', body: input.body, currentUser: input.currentUser },
      async () => {
        const cutoff = new Date(Date.now() - input.body.maxIdleMinutes * 60_000);
        const where = { tenantId: input.tenantId, sessionStatus: 'active', startedAt: { [Op.lt]: cutoff } };
        const selected = await this.sessionModel.count({ where } as never);
        let expired = 0;
        if (!input.body.dryRun) {
          const [count] = await this.sessionModel.update({ sessionStatus: 'expired', endedAt: new Date() }, { where } as never);
          expired = count;
        }
        return { selected, expired, cutoff: cutoff.toISOString(), dryRun: input.body.dryRun };
      },
    );
  }

  async applyRetentionPolicies(input: { tenantId: string; body: ApplyRetentionPoliciesDto; currentUser: AuthenticatedUser }) {
    return this.runJob(
      { tenantId: input.tenantId, jobCode: 'apply_retention_policies', body: input.body, currentUser: input.currentUser },
      async () => {
        const where: Record<string, unknown> = { isActive: true };
        if (input.body.policyCode) where.policyCode = input.body.policyCode;
        const policies = await this.retentionPolicyModel.findAll({ where } as never);

        const outcomes: RetentionOutcome[] = [];
        const unmappedPolicies: string[] = [];

        for (const policy of policies) {
          if (!policy.policyCode || !policy.retentionDays) {
            continue;
          }
          const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
          const outcome = await this.executeRetentionTarget(policy.policyCode, cutoffDate, input.body.dryRun);
          if (outcome) {
            outcomes.push(outcome);
            this.logger.log(
              `Retención ${input.body.dryRun ? '(dry-run) ' : ''}policy=${policy.policyCode} table=${outcome.table} action=${outcome.action} affected=${outcome.affected}`,
            );
          } else {
            unmappedPolicies.push(policy.policyCode);
          }
        }

        const destructiveActionsExecuted = input.body.dryRun ? 0 : outcomes.reduce((sum, o) => sum + o.affected, 0);

        return {
          policiesScanned: policies.length,
          destructiveActionsExecuted,
          dryRun: input.body.dryRun,
          outcomes,
          unmappedPolicies,
          note:
            unmappedPolicies.length > 0
              ? `Políticas activas sin tabla registrada en RETENTION_TARGETS (no se ejecutó ninguna acción para ellas): ${unmappedPolicies.join(', ')}. Ver PENDIENTE_ATLAS en docs/pending/pending-items.md.`
              : 'Todas las políticas activas evaluadas tienen una tabla registrada en RETENTION_TARGETS.',
        };
      },
    );
  }

  async recalculateDataQuality(input: { tenantId: string; body: RecalculateDataQualityDto; currentUser: AuthenticatedUser }) {
    return this.runJob(
      { tenantId: input.tenantId, jobCode: 'recalculate_data_quality', body: input.body, currentUser: input.currentUser },
      async () => {
        const where: Record<string, unknown> = { tenantId: input.tenantId, issueStatus: 'open' };
        if (input.body.customerId) {
          where.targetTable = 'customers';
          where.targetRecordId = input.body.customerId;
        }
        const openIssues = await this.dataQualityIssueModel.count({ where } as never);
        return {
          openIssues,
          issuesCreated: 0,
          dryRun: input.body.dryRun,
          note: 'Recalcula conteos actuales; las reglas automáticas de calidad quedan para workers específicos por regla.',
        };
      },
    );
  }

  private async runJob(
    input: { tenantId: string; jobCode: string; body: Record<string, unknown>; currentUser: AuthenticatedUser },
    handler: () => Promise<Record<string, unknown>>,
  ) {
    const now = new Date();
    const run = await this.jobRunModel.create({
      tenantId: input.tenantId,
      jobCode: input.jobCode,
      status: 'running',
      startedAt: now,
      completedAt: null,
      inputJson: input.body,
      resultJson: null,
      errorMessage: null,
      triggeredByType: input.currentUser.role,
      triggeredById: actorId(input.currentUser),
      createdAtValue: now,
    });

    try {
      const result = await this.sequelize.transaction(async (transaction) => {
        const jobResult = await handler();
        await this.auditModel.create(
          {
            tenantId: input.tenantId,
            actorType: input.currentUser.role,
            actorInternalUserId: input.currentUser.internalUserId ?? null,
            actorPlatformUserId: input.currentUser.platformUserId ?? null,
            actionCode: `job_${input.jobCode}_executed`,
            targetType: 'system_job_run',
            targetId: String(run.id),
            ipAddress: null,
            userAgent: null,
            payloadJson: jobResult,
            occurredAt: new Date(),
            createdAtValue: new Date(),
          },
          { transaction },
        );
        return jobResult;
      });
      run.status = 'completed';
      run.completedAt = new Date();
      run.resultJson = result;
      await run.save();
      return { jobRunId: String(run.id), status: 'completed', result };
    } catch (error) {
      run.status = 'failed';
      run.completedAt = new Date();
      run.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await run.save();
      throw error;
    }
  }
}
