import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SystemsCatalogQueryService } from '../../../src/modules/systems-ops/systems-catalog-query.service.js';

/**
 * `SystemsCatalogQueryService` es la lectura del catálogo de systems-ops (endpoints/dominios/tools/
 * entidades/impactos) más el dashboard. Spec directo con sus 5 colaboradores mockeados: cubre el
 * mapeo+meta, los NotFound, el enriquecimiento (join por id con dedup), relatedTables, la delegación
 * y la lógica de "posture" del dashboard.
 */
describe('SystemsCatalogQueryService', () => {
  function build() {
    const catalogRepository = {
      listEndpoints: jest.fn(async () => ({ rows: [] as unknown[], meta: {} })),
      findEndpointById: jest.fn(async () => null),
      findToolRequirementsByEndpoint: jest.fn(async () => [] as unknown[]),
      findDataImpactsByEndpoint: jest.fn(async () => [] as unknown[]),
      findFieldImpactsByEndpoint: jest.fn(async () => [] as unknown[]),
      findToolsByIds: jest.fn(async () => [] as unknown[]),
      findDataEntitiesByIds: jest.fn(async () => [] as unknown[]),
      listDomains: jest.fn(async () => ({ rows: [] as unknown[], meta: {} })),
      findDomainByCode: jest.fn(async () => null),
      listTools: jest.fn(async () => ({ rows: [] as unknown[], meta: {} })),
      findToolById: jest.fn(async () => null),
      listDataEntities: jest.fn(async () => ({ rows: [] as unknown[], meta: {} })),
      findDataEntityById: jest.fn(async () => null),
      findFieldsByEntity: jest.fn(async () => [] as unknown[]),
      findRelationshipsByTable: jest.fn(async () => [] as unknown[]),
      findDataEntityByTable: jest.fn(async () => null),
      findDataImpactsByEntity: jest.fn(async () => [] as unknown[]),
      findFieldsByTable: jest.fn(async () => [] as unknown[]),
      findFieldImpactsByDataEntity: jest.fn(async () => [] as unknown[]),
    };
    const dashboardRepository = { getDashboardCounts: jest.fn(async () => ({ endpoints: 0, dataEntities: 0, pendingReviews: 0, stressProfiles: 0 })) };
    const discovery = { discoverAndMaybePersist: jest.fn(async () => ({ discovered: 1 })) };
    const seedService = { refreshCatalog: jest.fn(async () => ({ refreshed: true })) };
    const healthService = { getToolsHealth: jest.fn(async () => [{ code: 'POSTGRES' }]) };
    const service = new SystemsCatalogQueryService(
      catalogRepository as never,
      dashboardRepository as never,
      discovery as never,
      seedService as never,
      healthService as never,
    );
    return { service, catalogRepository, dashboardRepository, discovery, seedService, healthService };
  }

  const user = { role: 'internal_operator', tenantId: 't1' } as never;

  it('listEndpoints mapea filas a DTO y propaga el meta', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.listEndpoints as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 3, code: 'EP', method: 'GET' }], meta: { page: 1 } } as never);
    const res = await service.listEndpoints({} as never);
    expect(res.items[0]).toMatchObject({ endpointId: '3', code: 'EP' });
    expect(res.meta).toEqual({ page: 1 });
  });

  it('getEndpoint lanza NotFound cuando no existe', async () => {
    const { service } = build();
    await expect(service.getEndpoint('3')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getEndpoint enriquece tool-requirements uniendo por id con dedup', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findEndpointById as jest.Mock).mockResolvedValueOnce({ id: 5, code: 'EP', method: 'GET' } as never);
    (catalogRepository.findToolRequirementsByEndpoint as jest.Mock).mockResolvedValueOnce([
      { id: 1, endpointId: 5, toolId: 9 },
      { id: 2, endpointId: 5, toolId: 9 }, // mismo tool -> se debe pedir una sola vez
    ] as never);
    (catalogRepository.findToolsByIds as jest.Mock).mockResolvedValueOnce([{ id: 9, code: 'TOOL', name: 'Tool', type: 'api' }] as never);
    const res = await service.getEndpoint('5');
    expect(catalogRepository.findToolsByIds).toHaveBeenCalledWith(['9']);
    expect(res.toolRequirements).toHaveLength(2);
    expect(res.toolRequirements[0]).toMatchObject({ tool: { code: 'TOOL', name: 'Tool', type: 'api' } });
  });

  it('getTool y getDomain lanzan NotFound o devuelven el mapeo', async () => {
    const { service, catalogRepository } = build();
    await expect(service.getTool('1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getDomain('D')).rejects.toBeInstanceOf(NotFoundException);
    (catalogRepository.findToolById as jest.Mock).mockResolvedValueOnce({ id: 9, code: 'TOOL', name: 'Tool' } as never);
    expect(await service.getTool('9')).toMatchObject({ toolId: '9', code: 'TOOL' });
  });

  it('getDataEntity arma relatedTables deduplicando el otro extremo de la relación', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findDataEntityById as jest.Mock).mockResolvedValueOnce({ id: 7, schemaName: 's', tableName: 'orders' } as never);
    (catalogRepository.findFieldsByEntity as jest.Mock).mockResolvedValueOnce([{ id: 1, columnName: 'c' }] as never);
    (catalogRepository.findRelationshipsByTable as jest.Mock).mockResolvedValueOnce([
      { id: 1, sourceTable: 'orders', targetTable: 'customers' },
      { id: 2, sourceTable: 'items', targetTable: 'orders' },
    ] as never);
    const res = await service.getDataEntity('7');
    expect(res.relatedTables).toEqual(expect.arrayContaining(['customers', 'items']));
    expect(res.relatedTables).toHaveLength(2);
    expect(res.columns).toHaveLength(1);
  });

  it('getImpactByTable lanza NotFound o mapea el impacto con su entidad', async () => {
    const { service, catalogRepository } = build();
    await expect(service.getImpactByTable('s', 't')).rejects.toBeInstanceOf(NotFoundException);
    (catalogRepository.findDataEntityByTable as jest.Mock).mockResolvedValueOnce({ id: 7, schemaName: 's', tableName: 't', entityName: 'E' } as never);
    (catalogRepository.findDataImpactsByEntity as jest.Mock).mockResolvedValueOnce([{ id: 1, endpointId: 2, dataEntityId: 7 }] as never);
    const res = await service.getImpactByTable('s', 't');
    expect(res.entity).toMatchObject({ entityId: '7' });
    expect(res.endpointImpacts).toHaveLength(1);
  });

  it('delega discover, refreshCatalogSeed y getToolsHealth en sus colaboradores', async () => {
    const { service, discovery, seedService, healthService } = build();
    await service.discoverEndpoints({ persist: true } as never);
    await service.refreshCatalogSeed({} as never, user);
    await service.getToolsHealth();
    expect(discovery.discoverAndMaybePersist).toHaveBeenCalledWith(true);
    expect(seedService.refreshCatalog).toHaveBeenCalledWith({}, user);
    expect(healthService.getToolsHealth).toHaveBeenCalledTimes(1);
  });

  it('getDashboard marca READY_FOR_REVIEW solo con endpoints y entidades presentes', async () => {
    const { service, dashboardRepository } = build();
    (dashboardRepository.getDashboardCounts as jest.Mock).mockResolvedValueOnce({ endpoints: 5, dataEntities: 3, pendingReviews: 2, stressProfiles: 1 } as never);
    const ready = await service.getDashboard();
    expect(ready.posture).toMatchObject({ catalogCoverage: 'READY_FOR_REVIEW', pendingReviews: 2, stressProfilesEnabled: 1 });

    const { service: s2 } = build(); // counts en cero por defecto
    const needs = await s2.getDashboard();
    expect(needs.posture.catalogCoverage).toBe('NEEDS_SEED_REFRESH');
  });
});
