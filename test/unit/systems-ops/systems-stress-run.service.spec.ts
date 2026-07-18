import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SystemsStressRunService } from '../../../src/modules/systems-ops/systems-stress-run.service.js';

/**
 * `SystemsStressRunService` encola planes de stress (la ejecución real la hace un worker externo) y
 * lista corridas. Spec directo con los 2 modelos mockeados: cubre las validaciones de encolado, la
 * redacción de headers sensibles y el armado del where con scope de tenant.
 */
describe('SystemsStressRunService', () => {
  function build() {
    const stressProfileModel = { findByPk: jest.fn(async () => null) };
    const jobRunModel = {
      create: jest.fn(async () => ({ id: 1, jobCode: 'systems_stress_run', status: 'queued' })),
      findAndCountAll: jest.fn(async () => ({ rows: [] as unknown[], count: 0 })),
    };
    const service = new SystemsStressRunService(stressProfileModel as never, jobRunModel as never);
    return { service, stressProfileModel, jobRunModel };
  }

  const user = { role: 'internal_operator', tenantId: 't1', internalUserId: 'u1', platformUserId: null } as never;
  const activeProfile = (over: Record<string, unknown> = {}) => ({
    id: 5,
    endpointId: 9,
    code: 'STRESS_EP',
    isEnabled: true,
    status: 'ACTIVE',
    environmentScope: ['TEST'],
    requiresApproval: false,
    targetRps: 10,
    durationSeconds: 60,
    concurrency: 5,
    maxErrorRate: '0.05',
    maxP95Ms: 500,
    ...over,
  });
  const input = (over: Record<string, unknown> = {}) => ({ environment: 'TEST', dryRun: true, headers: {}, config: {}, ...over });

  it('queueStressRun lanza NotFound si el perfil no existe', async () => {
    const { service } = build();
    await expect(service.queueStressRun('5', input() as never, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza perfil inactivo, entorno no permitido, producción y falta de ticket', async () => {
    const { service, stressProfileModel } = build();
    (stressProfileModel.findByPk as jest.Mock).mockResolvedValueOnce(activeProfile({ isEnabled: false }) as never);
    await expect(service.queueStressRun('5', input() as never, user)).rejects.toBeInstanceOf(BadRequestException);

    (stressProfileModel.findByPk as jest.Mock).mockResolvedValueOnce(activeProfile({ environmentScope: ['STAGING'] }) as never);
    await expect(service.queueStressRun('5', input({ environment: 'TEST' }) as never, user)).rejects.toBeInstanceOf(BadRequestException);

    (stressProfileModel.findByPk as jest.Mock).mockResolvedValueOnce(activeProfile({ environmentScope: ['PRODUCTION_READONLY'] }) as never);
    await expect(service.queueStressRun('5', input({ environment: 'PRODUCTION_READONLY' }) as never, user)).rejects.toBeInstanceOf(BadRequestException);

    (stressProfileModel.findByPk as jest.Mock).mockResolvedValueOnce(activeProfile({ requiresApproval: true }) as never);
    await expect(service.queueStressRun('5', input({ dryRun: false }) as never, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('queueStressRun encola el plan y redacta los headers sensibles', async () => {
    const { service, stressProfileModel, jobRunModel } = build();
    (stressProfileModel.findByPk as jest.Mock).mockResolvedValueOnce(activeProfile() as never);
    const res = await service.queueStressRun('5', input({ headers: { Authorization: 'Bearer x', 'X-Trace': 'ok' } }) as never, user);
    expect(res.queued).toBe(true);
    const [args] = jobRunModel.create.mock.calls[0] as [{ inputJson: { headers: Record<string, string> }; status: string }];
    expect(args.status).toBe('queued');
    expect(args.inputJson.headers).toEqual({ Authorization: '[REDACTED]', 'X-Trace': 'ok' });
  });

  it('listStressRuns arma el where (jobCode + status en minúscula + tenant) y pagina', async () => {
    const { service, jobRunModel } = build();
    (jobRunModel.findAndCountAll as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, jobCode: 'systems_stress_run', status: 'queued' }],
      count: 1,
    } as never);
    const res = await service.listStressRuns({ status: 'QUEUED', page: 1, limit: 10 } as never, user);
    const [opts] = jobRunModel.findAndCountAll.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(opts.where).toMatchObject({ jobCode: 'systems_stress_run', status: 'queued', tenantId: 't1' });
    expect(res.items[0]).toMatchObject({ jobRunId: '1' });
    expect(res.meta).toMatchObject({ total: 1, page: 1, limit: 10 });
  });
});
