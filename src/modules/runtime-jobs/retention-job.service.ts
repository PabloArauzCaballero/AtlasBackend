/**
 * @file Servicio de aplicación: trabajo de fondo que aplica las políticas de retención de datos.
 * @business Borra o anonimiza datos vencidos según la política activa; un error aquí borra lo que no debía.
 * @system recorre políticas activas, ejecuta el destino registrado de cada una y reporta lo que no tiene destino.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import {
  AddressGpsObservationModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  RetentionPolicyModel,
  SystemActionLogModel,
  SystemJobRunModel,
} from '../../database/models/index.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import { RETENTION_POLICIES_PENDING_DECISION } from './retention-targets.js';
import { executeRetentionTarget as executeRetentionTargetImpl, type RetentionOutcome } from './retention-execution.js';
import { ApplyRetentionPoliciesDto } from './runtime-jobs.schemas.js';

@Injectable()
export class RetentionJobService {
  private readonly logger = new Logger(RetentionJobService.name);

  constructor(
    @InjectModel(RetentionPolicyModel) private readonly retentionPolicyModel: typeof RetentionPolicyModel,
    @InjectModel(AddressGpsObservationModel) private readonly gpsObservationModel: typeof AddressGpsObservationModel,
    @InjectModel(DeviceSnapshotModel) private readonly deviceSnapshotModel: typeof DeviceSnapshotModel,
    @InjectModel(FormFieldInteractionEventModel) private readonly formInteractionModel: typeof FormFieldInteractionEventModel,
    @InjectModel(SystemJobRunModel) private readonly systemJobRunModel: typeof SystemJobRunModel,
    @InjectModel(SystemActionLogModel) private readonly systemActionLogModel: typeof SystemActionLogModel,
    private readonly jobRuns: JobRunRecorderService,
  ) {}

  private executeRetentionTarget(policyCode: string, cutoffDate: Date, dryRun: boolean): Promise<RetentionOutcome | null> {
    return executeRetentionTargetImpl(
      policyCode,
      cutoffDate,
      dryRun,
      {
        gpsObservationModel: this.gpsObservationModel,
        deviceSnapshotModel: this.deviceSnapshotModel,
        formInteractionModel: this.formInteractionModel,
        systemJobRunModel: this.systemJobRunModel,
        systemActionLogModel: this.systemActionLogModel,
      },
      this.logger,
    );
  }

  async applyRetentionPolicies(input: { tenantId: string; body: ApplyRetentionPoliciesDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
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

        // ATLAS-DATA-004. Una política ACTIVA sin destino ejecutable es un control declarado que no
        // se ejerce; en KYC eso es un hallazgo de cumplimiento. Antes solo aparecía dentro del JSON
        // de resultado (`unmappedPolicies`), donde nadie lo miraba. Ahora se separan dos casos:
        //  - decisión pendiente YA DECLARADA (con su motivo en `retention-targets.ts`): se informa;
        //  - política sin destino y sin decisión: se registra como ERROR, porque significa que
        //    alguien sembró una política y `check:retention-coverage` no llegó a bloquearla.
        const undeclared = unmappedPolicies.filter((code) => !(code in RETENTION_POLICIES_PENDING_DECISION));
        if (undeclared.length > 0) {
          this.logger.error(
            `Políticas de retención ACTIVAS sin destino ejecutable ni decisión declarada: ${undeclared.join(', ')}. ` +
              'La política existe en base y no se está aplicando. Resolver en src/modules/runtime-jobs/retention-targets.ts.',
          );
        }
        const pendingDecision = unmappedPolicies.filter((code) => code in RETENTION_POLICIES_PENDING_DECISION);
        if (pendingDecision.length > 0) {
          this.logger.warn(`Políticas de retención activas con decisión pendiente declarada: ${pendingDecision.join(', ')}.`);
        }

        return {
          policiesScanned: policies.length,
          destructiveActionsExecuted,
          dryRun: input.body.dryRun,
          outcomes,
          unmappedPolicies,
          pendingDecision: pendingDecision.map((code) => ({ policyCode: code, reason: RETENTION_POLICIES_PENDING_DECISION[code] })),
          undeclaredPolicies: undeclared,
          note:
            unmappedPolicies.length === 0
              ? 'Todas las políticas activas evaluadas tienen una tabla registrada en RETENTION_TARGETS.'
              : `${pendingDecision.length} política(s) con decisión pendiente declarada y ${undeclared.length} sin declarar.`,
        };
      },
    );
  }
}
