/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import { OperationalAuditLogModel, SystemJobRunModel } from '../../database/models/index.js';

export type JobRunResult = { jobRunId: string; status: 'completed'; result: Record<string, unknown> };

/**
 * Envoltura de auditoría común a TODOS los trabajos de fondo: abre la fila en `system_job_runs`,
 * ejecuta el handler dentro de una transacción junto con su entrada en `operational_audit_logs`, y
 * cierra la fila como `completed` o `failed`.
 *
 * Vive en su propio servicio porque hay más de un servicio de jobs (`RuntimeJobsService` para el
 * procesamiento de dominio y `RuntimeMaintenanceJobsService` para el saneamiento de colas) y la
 * alternativa era duplicar esta lógica o hacer que uno dependiera del otro solo para reutilizarla.
 * Que la evidencia de ejecución se escriba SIEMPRE igual, venga de donde venga el job, es
 * precisamente lo que hace confiable a `system_job_runs`.
 *
 * El resultado del handler se persiste tal cual en `result_json` y en el payload de auditoría: los
 * jobs devuelven conteos y cortes de fecha, nunca datos del cliente.
 */
@Injectable()
export class JobRunRecorderService {
  constructor(
    @InjectModel(SystemJobRunModel) private readonly jobRunModel: typeof SystemJobRunModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async run(
    input: { tenantId: string; jobCode: string; body: Record<string, unknown>; currentUser: AuthenticatedUser },
    handler: () => Promise<Record<string, unknown>>,
  ): Promise<JobRunResult> {
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
