import { describe, expect, it, jest } from '@jest/globals';
import { SystemsCatalogRepository } from '../../../src/modules/systems-ops/systems-catalog.repository.js';

/**
 * Cobertura directa de `SystemsCatalogRepository` (Fase 1.2 del plan 10/10): los finders del catálogo
 * de endpoints, que de paso ejercitan los helpers de paginación y de construcción del `where` de
 * búsqueda. Los 11 modelos Sequelize se mockean.
 */
describe('SystemsCatalogRepository', () => {
  function buildRepo() {
    const make = () => {
      const model = {
        findAndCountAll: jest.fn(),
        findByPk: jest.fn(),
        findOne: jest.fn(),
        findAll: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        // `SystemDataEntityCatalogModel` excluye la narrativa larga por `defaultScope`; el detalle
        // la pide con `.unscoped()`. El mock devuelve el mismo objeto para que las aserciones sobre
        // `findByPk`/`findOne` sigan valiendo con y sin scope.
        unscoped: jest.fn(),
      };
      model.unscoped.mockReturnValue(model as never);
      return model;
    };
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
    // Índices del constructor: 0 endpoint, 1 tool, 2 endpointTool, 3 dataEntity, 4 dataImpact,
    // 5 fieldImpact, 6 dataField, 7 relationship, 8 operationalRule, 9 domain, 10 payloadContract.
    return { repo, endpointModel: models[0], models };
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

  describe('upserts (seed del catálogo)', () => {
    it('upsertEndpoint aplica defaults y deriva isReadonly de GET', async () => {
      const { repo, models } = buildRepo();
      await repo.upsertEndpoint({
        code: 'EP',
        module: 'auth',
        method: 'GET',
        fullPath: '/api/v1/x',
        routeName: 'x',
        businessPurpose: 'p',
      } as never);
      const values = (models[0].upsert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(values).toMatchObject({ code: 'EP', method: 'GET', isReadonly: true, riskLevel: 'LOW', status: 'ACTIVE' });
    });

    it('upsertTool aplica defaults y la rama de failureRisks por isCritical', async () => {
      const { repo, models } = buildRepo();
      await repo.upsertTool({ code: 'T', name: 'Tool', type: 'api', purpose: 'do things', isCritical: true } as never);
      const values = (models[1].upsert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(values).toMatchObject({ code: 'T', name: 'Tool' });
      expect(String(values.failureRisks)).toContain('crítica');
    });

    it('upsertDataEntity y upsertDataImpact delegan en su modelo', async () => {
      const { repo, models } = buildRepo();
      await repo.upsertDataEntity({
        schemaName: 's',
        tableName: 't',
        entityName: 'E',
        module: 'm',
        businessPurpose: 'p',
        containsPii: false,
        containsFinancialData: false,
        containsRiskData: false,
        containsLegalData: false,
        containsDeviceData: false,
        containsLocationData: false,
        isAuditCritical: false,
        detectedFrom: 'seed',
        confidenceLevel: 'MEDIUM',
        reviewStatus: 'NEEDS_REVIEW',
      } as never);
      expect(models[3].upsert).toHaveBeenCalledTimes(1);
      await repo.upsertDataImpact({ endpointId: 'e1', dataEntityId: 'de1', operationType: 'READ', impactLevel: 'LOW' } as never);
      expect(models[4].upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateDataEntityMetadata', () => {
    it('devuelve null si no existe; si existe aplica solo los campos presentes en el body y guarda', async () => {
      const missing = buildRepo();
      (missing.models[3].findByPk as jest.Mock).mockResolvedValue(null as never);
      expect(await missing.repo.updateDataEntityMetadata('e1', {})).toBeNull();

      const found = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const entity = { businessPurpose: 'old', status: 'ACTIVE', save } as Record<string, unknown>;
      (found.models[3].findByPk as jest.Mock).mockResolvedValue(entity as never);
      await found.repo.updateDataEntityMetadata('e1', { businessPurpose: 'nuevo', containsPii: true });
      expect(entity.businessPurpose).toBe('nuevo');
      expect(entity.containsPii).toBe(true);
      expect(entity.status).toBe('ACTIVE'); // no venía en el body
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe('markDeprecatedCandidates', () => {
    it('devuelve 0 cuando todos los candidatos siguen activos (sin UPDATE)', async () => {
      const { repo, models } = buildRepo();
      (models[0].findAll as jest.Mock).mockResolvedValue([{ id: 'e1', method: 'GET', fullPath: '/x' }] as never);
      const result = await repo.markDeprecatedCandidates(new Set(['GET /x']));
      expect(result).toBe(0);
      expect(models[0].update).not.toHaveBeenCalled();
    });

    it('marca como DEPRECATED_CANDIDATE los que no están en activeKeys', async () => {
      const { repo, models } = buildRepo();
      (models[0].findAll as jest.Mock).mockResolvedValue([{ id: 'e1', method: 'GET', fullPath: '/gone' }] as never);
      (models[0].update as jest.Mock).mockResolvedValue([1] as never);
      const result = await repo.markDeprecatedCandidates(new Set(['GET /still-here']));
      expect(result).toBe(1);
      expect(models[0].update).toHaveBeenCalledTimes(1);
    });
  });

  it('los list* consultan findAndCountAll de su propio modelo', async () => {
    const { repo, models } = buildRepo();
    for (const m of models) (m.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    const q = { page: 1, limit: 20 } as never;
    await repo.listTools(q);
    await repo.listDataEntities(q);
    await repo.listDataFields(q);
    await repo.listRelationships(q);
    await repo.listOperationalRules(q);
    await repo.listDomains(q);
    expect(models[1].findAndCountAll).toHaveBeenCalled(); // tools
    expect(models[3].findAndCountAll).toHaveBeenCalled(); // dataEntities
    expect(models[6].findAndCountAll).toHaveBeenCalled(); // dataFields
    expect(models[7].findAndCountAll).toHaveBeenCalled(); // relationships
    expect(models[8].findAndCountAll).toHaveBeenCalled(); // operationalRules
    expect(models[9].findAndCountAll).toHaveBeenCalled(); // domains
  });

  it('finders varios delegan en su modelo; los *ByIds cortan con lista vacía', async () => {
    const { repo, models } = buildRepo();
    for (const m of models) {
      (m.findByPk as jest.Mock).mockResolvedValue(null as never);
      (m.findOne as jest.Mock).mockResolvedValue(null as never);
      (m.findAll as jest.Mock).mockResolvedValue([] as never);
    }
    await repo.findToolById('t1');
    await repo.findToolByCode('C');
    expect(await repo.findToolsByIds([])).toEqual([]); // corte
    await repo.findToolsByIds(['t1']);
    await repo.findDataEntityById('d1');
    await repo.findDataEntityByTable('s', 't');
    expect(await repo.findDataEntitiesByIds([])).toEqual([]); // corte
    await repo.findDomainByCode('D');
    await repo.findRelationshipsByTable('s', 't');
    await repo.findFieldsByEntity('d1');
    await repo.findToolRequirementsByEndpoint('e1');
    await repo.findDataImpactsByEndpoint('e1');
    await repo.findFieldImpactsByEndpoint('e1');
    await repo.findPayloadContractsByEndpoint('e1');
    expect(models[1].findByPk).toHaveBeenCalledWith('t1');
    expect(models[9].findOne).toHaveBeenCalled(); // domainByCode
    expect(models[2].findAll).toHaveBeenCalled(); // toolRequirementsByEndpoint
    expect(models[10].findAll).toHaveBeenCalled(); // payloadContracts
  });
});
