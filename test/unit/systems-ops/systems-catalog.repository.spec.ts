import { describe, expect, it, jest } from '@jest/globals';
import { SystemsCatalogRepository } from '../../../src/modules/systems-ops/systems-catalog.repository.js';

/**
 * Cobertura directa de `SystemsCatalogRepository` (Fase 1.2 del plan 10/10): los finders del catálogo
 * de endpoints, que de paso ejercitan los helpers de paginación y de construcción del `where` de
 * búsqueda. Los 11 modelos Sequelize se mockean.
 */
describe('SystemsCatalogRepository', () => {
  function buildRepo() {
    const make = () => ({ findAndCountAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), upsert: jest.fn() });
    const models = Array.from({ length: 11 }, make);
    const repo = new SystemsCatalogRepository(
      models[0] as never,
      models[1] as never,
      models[2] as never,
      models[3] as never,
      models[4] as never,
      models[5] as never,
      models[6] as never,
      models[7] as never,
      models[8] as never,
      models[9] as never,
      models[10] as never,
    );
    return { repo, endpointModel: models[0] };
  }

  it('listEndpoints pagina y devuelve rows + meta', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [{ id: 'e1' }], count: 1 } as never);
    const result = (await repo.listEndpoints({ page: 1, limit: 20 } as never)) as { rows: unknown[]; meta: unknown };
    expect(result.rows).toEqual([{ id: 'e1' }]);
    expect(result.meta).toBeDefined();
    expect(endpointModel.findAndCountAll).toHaveBeenCalledTimes(1);
  });

  it('findEndpointById usa la PK', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findByPk as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
    await expect(repo.findEndpointById('e1')).resolves.toEqual({ id: 'e1' });
    expect(endpointModel.findByPk).toHaveBeenCalledWith('e1');
  });

  it('findEndpointByMethodAndPath normaliza el método a mayúsculas', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findEndpointByMethodAndPath('get', '/api/v1/health');
    expect((endpointModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { method: 'GET', fullPath: '/api/v1/health' },
    });
  });
});
