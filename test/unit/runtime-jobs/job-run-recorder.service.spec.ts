import { describe, expect, it, jest } from '@jest/globals';
import { JobRunRecorderService } from '../../../src/modules/runtime-jobs/job-run-recorder.service.js';

/**
 * La envoltura de auditoría de los trabajos de fondo se extrajo de `RuntimeJobsService` cuando
 * apareció un segundo servicio de jobs (`RuntimeMaintenanceJobsService`): duplicarla o hacer que uno
 * dependiera del otro solo para reutilizarla habría erosionado justo lo que hace confiable a
 * `system_job_runs` — que la evidencia se escriba SIEMPRE igual, venga de donde venga el job.
 *
 * Estas pruebas cubren lo que antes se verificaba indirectamente a través de `applyRetentionPolicies`.
 */
describe('JobRunRecorderService', () => {
  const currentUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;

  function build() {
    const run = {
      id: 77,
      status: 'running',
      completedAt: null,
      resultJson: null,
      errorMessage: null,
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const jobRunModel = { create: jest.fn(async (..._args: unknown[]) => run) };
    const auditModel = { create: jest.fn(async (..._args: unknown[]) => ({})) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const recorder = new JobRunRecorderService(jobRunModel as never, auditModel as never, sequelize as never);
    return { recorder, run, jobRunModel, auditModel, sequelize };
  }

  const input = { tenantId: 't1', jobCode: 'apply_retention_policies', body: { dryRun: true }, currentUser };

  it('abre la fila como running con el actor que disparó el job', async () => {
    const { recorder, jobRunModel } = build();

    await recorder.run(input, async () => ({ ok: true }));

    const created = (jobRunModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(created).toMatchObject({
      tenantId: 't1',
      jobCode: 'apply_retention_policies',
      status: 'running',
      triggeredByType: 'internal_operator',
    });
  });

  it('cierra la fila como completed y persiste el resultado del handler', async () => {
    const { recorder, run } = build();

    const response = await recorder.run(input, async () => ({ selected: 3 }));

    expect(response).toMatchObject({ jobRunId: '77', status: 'completed', result: { selected: 3 } });
    expect(run.status).toBe('completed');
    expect(run.resultJson).toEqual({ selected: 3 });
  });

  it('escribe la entrada de auditoría con el actionCode del job, dentro de la transacción', async () => {
    const { recorder, auditModel, sequelize } = build();

    await recorder.run(input, async () => ({ ok: true }));

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    const audit = (auditModel.create as jest.Mock).mock.calls[0][0] as { actionCode: string; targetId: string };
    expect(audit.actionCode).toBe('job_apply_retention_policies_executed');
    expect(audit.targetId).toBe('77');
  });

  it('un handler que falla deja la fila como failed con el mensaje, y re-lanza', async () => {
    const { recorder, run } = build();

    await expect(recorder.run(input, async () => Promise.reject(new Error('DB unreachable')))).rejects.toThrow('DB unreachable');

    expect(run.status).toBe('failed');
    expect(run.errorMessage).toBe('DB unreachable');
  });
});
