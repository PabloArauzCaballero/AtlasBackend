import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { ExternalProviderCatalogRepository } from '../../../src/modules/external-data/infrastructure/external-provider-catalog.repository.js';

/**
 * Cobertura directa de `ExternalProviderCatalogRepository`: proveedores, políticas de costo y bitácora de salud. Modelos Sequelize mockeados.
 */
describe('ExternalProviderCatalogRepository', () => {
  function buildRepo() {
    const make = () => ({
      findOne: asyncMock(),
      findAll: asyncMock(),
      findByPk: asyncMock(),
      create: asyncMock(),
      update: asyncMock(),
      count: asyncMock(),
      bulkCreate: asyncMock(),
    });
    const models = {
      dataProvider: make(),
      costPolicy: make(),
      providerHealthLog: make(),
    };
    const repo = new ExternalProviderCatalogRepository(
      models.dataProvider as never,
      models.costPolicy as never,
      models.providerHealthLog as never,
    );
    return { repo, models };
  }

  it('findProviderByCode / findProviderById / findCostPolicy filtran por sus claves', async () => {
    const { repo, models } = buildRepo();
    (models.dataProvider.findOne as jest.Mock).mockResolvedValue({ id: 'p1' } as never);
    (models.dataProvider.findByPk as jest.Mock).mockResolvedValue({ id: 'p1' } as never);
    (models.costPolicy.findOne as jest.Mock).mockResolvedValue(null as never);

    await repo.findProviderByCode('INFOCENTER');
    await repo.findProviderById('p1');
    await repo.findCostPolicy('p1', 'credit_check');

    expect((models.dataProvider.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerCode: 'INFOCENTER' } });
    expect(models.dataProvider.findByPk).toHaveBeenCalledWith('p1');
    // findCostPolicy solo devuelve la política ACTIVA.
    expect((models.costPolicy.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { providerId: 'p1', queryType: 'credit_check', active: true },
    });
  });

  it('updateCostPolicy devuelve null si no existe; si existe aplica solo los campos del patch', async () => {
    const missing = buildRepo();
    (missing.models.costPolicy.findOne as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.updateCostPolicy('p1', 'q', {})).toBeNull();

    const found = buildRepo();
    const policy = { update: jest.fn(async (..._args: unknown[]) => undefined) };
    (found.models.costPolicy.findOne as jest.Mock).mockResolvedValue(policy as never);
    const res = await found.repo.updateCostPolicy('p1', 'q', { unitCostAmount: 1.5, currency: 'BOB', active: false });
    expect(res).toBe(policy);
    const update = (policy.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(update).toMatchObject({ unitCostAmount: '1.5000', currency: 'BOB', active: false });
    expect(update.costTier).toBeUndefined(); // no venía en el patch
  });

  it('updateProviderRuntime devuelve null si no existe; si existe aplica el patch', async () => {
    const missing = buildRepo();
    (missing.models.dataProvider.findByPk as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.updateProviderRuntime('p1', {})).toBeNull();

    const found = buildRepo();
    const provider = { update: jest.fn(async (..._args: unknown[]) => undefined) };
    (found.models.dataProvider.findByPk as jest.Mock).mockResolvedValue(provider as never);
    await found.repo.updateProviderRuntime('p1', { providerStatus: 'DEGRADED', isActive: false });
    expect((provider.update as jest.Mock).mock.calls[0][0]).toMatchObject({ providerStatus: 'DEGRADED', isActive: false });
  });

  it('createHealthLog crea con sus campos derivados', async () => {
    const { repo, models } = buildRepo();
    (models.providerHealthLog.create as jest.Mock).mockResolvedValue({ id: 'h1' } as never);
    await repo.createHealthLog({
      providerId: 'p1',
      health: { providerCode: 'SEGIP', status: 'UP', mode: 'local', latencyMs: 5, checkedAt: '2026-01-01T00:00:00.000Z' } as never,
    });
    expect((models.providerHealthLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      status: 'UP',
      errorCode: null,
      metadataJson: { providerCode: 'SEGIP' },
    });
  });

  it('listProviders ordena por código y listCostPolicies filtra por proveedor', async () => {
    const { repo, models } = buildRepo();
    (models.dataProvider.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.costPolicy.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listProviders();
    expect((models.dataProvider.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ order: [['provider_code', 'ASC']] });
    await repo.listCostPolicies('p1');
    expect((models.costPolicy.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerId: 'p1' } });
  });
});
