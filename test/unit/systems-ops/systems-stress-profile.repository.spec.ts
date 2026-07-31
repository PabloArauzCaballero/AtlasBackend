import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SystemsStressProfileRepository } from '../../../src/modules/systems-ops/systems-stress-profile.repository.js';

/**
 * Cobertura directa de `SystemsStressProfileRepository` (Fase 1.2 del plan 10/10): listado/upsert de
 * perfiles de estrés y el listado de endpoints que requieren stress-test (con status por defecto
 * ACTIVE). El util de where es real. Modelos Sequelize mockeados.
 */
describe('SystemsStressProfileRepository', () => {
  function buildRepo() {
    const endpointModel = { findAndCountAll: asyncMock() };
    const stressProfileModel = { findAndCountAll: asyncMock(), findByPk: asyncMock(), upsert: asyncMock(), findAll: asyncMock() };
    const repo = new SystemsStressProfileRepository(endpointModel as never, stressProfileModel as never);
    return { repo, endpointModel, stressProfileModel };
  }

  it('listStressProfiles ordena por status y code y calcula offset', async () => {
    const { repo, stressProfileModel } = buildRepo();
    (stressProfileModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listStressProfiles({ status: 'active', page: 2, limit: 20 } as never);
    const arg = (stressProfileModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { order: unknown; offset: number };
    expect(arg.order).toEqual([
      ['status', 'ASC'],
      ['code', 'ASC'],
    ]);
    expect(arg.offset).toBe(20);
  });

  it('upsertStressProfile aplica notes ?? null y arrastra actorId a createdBy/updatedBy', async () => {
    const { repo, stressProfileModel } = buildRepo();
    (stressProfileModel.upsert as jest.Mock).mockResolvedValue([{ id: 'p1' }] as never);
    await repo.upsertStressProfile({
      endpointId: 'e1',
      code: 'C',
      name: 'N',
      targetRps: 10,
      durationSeconds: 60,
      concurrency: 5,
      environmentScope: ['dev'],
      maxErrorRate: 0.1,
      maxP95Ms: 500,
      isEnabled: true,
      requiresApproval: false,
      status: 'active',
      actorId: 'u1',
    } as never);
    expect((stressProfileModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({ notes: null, createdBy: 'u1', updatedBy: 'u1' });
  });

  it('findStressProfilesByEndpointIds corta en seco para lista vacía', async () => {
    const { repo, stressProfileModel } = buildRepo();
    const result = await repo.findStressProfilesByEndpointIds([]);
    expect(result).toEqual([]);
    expect(stressProfileModel.findAll).not.toHaveBeenCalled();
  });

  it('findStressProfilesByEndpointIds filtra por endpointId', async () => {
    const { repo, stressProfileModel } = buildRepo();
    (stressProfileModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findStressProfilesByEndpointIds(['e1', 'e2']);
    expect(callArg<CallArgRecord>(stressProfileModel.findAll, 0, 0).where).toEqual({ endpointId: ['e1', 'e2'] });
  });

  it('listStressRequiredEndpoints impone status por defecto ACTIVE y requiresStressTest true', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listStressRequiredEndpoints({ page: 1, limit: 10 } as never);
    const where = callArg<CallArgRecord>(endpointModel.findAndCountAll, 0, 0).where as Record<string, unknown>;
    expect(where).toMatchObject({ status: 'ACTIVE', requiresStressTest: true });
  });

  it('listStressRequiredEndpoints respeta el status explícito de la query', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listStressRequiredEndpoints({ status: 'DEPRECATED', page: 1, limit: 10 } as never);
    expect(callArg<CallArgRecord>(endpointModel.findAndCountAll, 0, 0).where.status).toBe('DEPRECATED');
  });
});
