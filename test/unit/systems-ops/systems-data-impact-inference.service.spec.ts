import { describe, expect, it, jest } from '@jest/globals';

/**
 * `SystemsDataImpactInferenceService.infer` deduce qué tablas lee/escribe cada endpoint escaneando su
 * código: llamadas a métodos del modelo (write/read), SQL crudo, referencia literal a la tabla,
 * referencia "bare" al modelo, y propagación INDIRECTA por FK. Se mockea readSourcesForEndpoint
 * (escaneo de disco) para controlar el "fuente" y ejercitar cada rama de clasificación.
 */
const mockReadSources = jest.fn(async (_endpoint?: unknown) => '');
jest.mock('../../../src/modules/systems-ops/systems-source-scan.util.js', () => ({
  readSourcesForEndpoint: (endpoint: unknown) => mockReadSources(endpoint),
  clearSourceScanCacheForTests: () => undefined,
}));

describe('SystemsDataImpactInferenceService', () => {
  async function build(entities: unknown[], relationships: unknown[] = []) {
    const { SystemsDataImpactInferenceService } = await import('../../../src/modules/systems-ops/systems-data-impact-inference.service.js');
    const repository = {
      listActiveEndpoints: jest.fn(async (..._args: unknown[]) => [{ id: 1, code: 'EP', module: 'customers', fullPath: '/x' }]),
      listEntitiesWithModel: jest.fn(async (..._args: unknown[]) => entities),
      listRelationships: jest.fn(async (..._args: unknown[]) => relationships),
      upsertImpact: jest.fn(async (..._args: unknown[]) => ({})),
    };
    const service = new SystemsDataImpactInferenceService(repository as never);
    return { service, repository };
  }

  it('DIRECT UPSERT con confianza HIGH (write+read) y lista las tablas no afectadas', async () => {
    mockReadSources.mockResolvedValueOnce('CustomerModel.create({}); luego CustomerModel.findAll();' as never);
    const { service } = await build([
      { tableName: 'customers', modelName: 'CustomerModel' },
      { tableName: 'audit', modelName: 'AuditModel' },
    ]);
    const res = await service.infer({ persist: false });
    expect(res.direct).toBe(1);
    expect(res.indirect).toBe(0);
    expect(res.items[0]).toMatchObject({ tableName: 'customers', impactKind: 'DIRECT', operationType: 'UPSERT', confidenceLevel: 'HIGH' });
    expect(res.unaffectedTables).toEqual(['audit']);
    expect(res.reviewStatus).toBe('DRY_RUN');
  });

  it('DIRECT READ (MEDIUM) cuando solo hay lectura del modelo', async () => {
    mockReadSources.mockResolvedValueOnce('await CustomerModel.findAll();' as never);
    const { service } = await build([{ tableName: 'customers', modelName: 'CustomerModel' }]);
    const res = await service.infer({ persist: false });
    expect(res.items[0]).toMatchObject({ operationType: 'READ', confidenceLevel: 'MEDIUM' });
  });

  it('SQL crudo de escritura sobre una tabla sin modelo => UPSERT MEDIUM', async () => {
    mockReadSources.mockResolvedValueOnce('await sequelize.query("INSERT INTO schema_tables (x) VALUES (1)");' as never);
    const { service } = await build([{ tableName: 'schema_tables', modelName: null }]);
    const res = await service.infer({ persist: false });
    expect(res.items[0]).toMatchObject({ tableName: 'schema_tables', operationType: 'UPSERT', confidenceLevel: 'MEDIUM' });
  });

  it('referencia literal a la tabla => READ LOW; referencia "bare" al modelo => READ LOW', async () => {
    mockReadSources.mockResolvedValueOnce('const t = "schema_tables";' as never);
    const literal = await build([{ tableName: 'schema_tables', modelName: null }]);
    expect((await literal.service.infer({ persist: false })).items[0]).toMatchObject({ operationType: 'READ', confidenceLevel: 'LOW' });

    mockReadSources.mockResolvedValueOnce('include: [CustomerModel]' as never);
    const bare = await build([{ tableName: 'customers', modelName: 'CustomerModel' }]);
    expect((await bare.service.infer({ persist: false })).items[0]).toMatchObject({ operationType: 'READ', confidenceLevel: 'LOW' });
  });

  it('propaga impacto INDIRECTO por la relación FK a la tabla vecina', async () => {
    mockReadSources.mockResolvedValueOnce('CustomerModel.findAll();' as never);
    const { service } = await build(
      [
        { tableName: 'customers', modelName: 'CustomerModel' },
        { tableName: 'orders', modelName: 'OrderModel' },
      ],
      [{ sourceTable: 'customers', targetTable: 'orders' }],
    );
    const res = await service.infer({ persist: false });
    expect(res.direct).toBe(1);
    expect(res.indirect).toBe(1);
    const orders = res.items.find((item) => item.tableName === 'orders');
    expect(orders).toMatchObject({ impactKind: 'INDIRECT', operationType: 'READ', confidenceLevel: 'LOW' });
  });

  it('con persist:true dispara los upserts y marca NEEDS_REVIEW', async () => {
    mockReadSources.mockResolvedValueOnce('CustomerModel.create({});' as never);
    const { service, repository } = await build([{ tableName: 'customers', modelName: 'CustomerModel' }]);
    const res = await service.infer({ persist: true });
    expect(res.persisted).toBeGreaterThanOrEqual(1);
    expect(res.reviewStatus).toBe('NEEDS_REVIEW');
    expect(repository.upsertImpact).toHaveBeenCalled();
  });
});
