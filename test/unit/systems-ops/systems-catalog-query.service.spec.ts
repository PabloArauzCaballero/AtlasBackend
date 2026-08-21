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
      listEndpoints: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findEndpointById: jest.fn(async (..._args: unknown[]) => null),
      findToolRequirementsByEndpoint: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findDataImpactsByEndpoint: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findFieldImpactsByEndpoint: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findToolsByIds: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findDataEntitiesByIds: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      listDomains: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findDomainByCode: jest.fn(async (..._args: unknown[]) => null),
      listTools: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findToolById: jest.fn(async (..._args: unknown[]) => null),
      listDataEntities: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findDataEntityById: jest.fn(async (..._args: unknown[]) => null),
      findFieldsByEntity: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findRelationshipsByTable: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findDataEntityByTable: jest.fn(async (..._args: unknown[]) => null),
      findDataImpactsByEntity: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findFieldsByTable: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findFieldImpactsByDataEntity: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    };
    const dashboardRepository = {
      getDashboardCounts: jest.fn(async (..._args: unknown[]) => ({ endpoints: 0, dataEntities: 0, pendingReviews: 0, stressProfiles: 0 })),
    };
    const discovery = { discoverAndMaybePersist: jest.fn(async (..._args: unknown[]) => ({ discovered: 1 })) };
    const openApiCatalog = { catalogFromContract: jest.fn(async (..._args: unknown[]) => ({ discovered: 333, withContract: 141 })) };
    const seedService = { refreshCatalog: jest.fn(async (..._args: unknown[]) => ({ refreshed: true })) };
    const healthService = { getToolsHealth: jest.fn(async (..._args: unknown[]) => [{ code: 'POSTGRES' }]) };
    const service = new SystemsCatalogQueryService(
      catalogRepository as never,
      dashboardRepository as never,
      discovery as never,
      openApiCatalog as never,
      seedService as never,
      healthService as never,
    );
    return { service, catalogRepository, dashboardRepository, discovery, openApiCatalog, seedService, healthService };
  }

  const user = { role: 'internal_operator', tenantId: 't1' } as never;

  it('listEndpoints mapea filas a DTO y propaga el meta', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.listEndpoints as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 3, code: 'EP', method: 'GET' }],
      meta: { page: 1 },
    } as never);
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
    (catalogRepository.findDataEntityByTable as jest.Mock).mockResolvedValueOnce({
      id: 7,
      schemaName: 's',
      tableName: 't',
      entityName: 'E',
    } as never);
    (catalogRepository.findDataImpactsByEntity as jest.Mock).mockResolvedValueOnce([{ id: 1, endpointId: 2, dataEntityId: 7 }] as never);
    const res = await service.getImpactByTable('s', 't');
    expect(res.entity).toMatchObject({ entityId: '7' });
    expect(res.endpointImpacts).toHaveLength(1);
  });

  it('delega refreshCatalogSeed y getToolsHealth en sus colaboradores', async () => {
    const { service, seedService, healthService } = build();
    await service.refreshCatalogSeed({} as never, user);
    await service.getToolsHealth();
    expect(seedService.refreshCatalog).toHaveBeenCalledWith({}, user);
    expect(healthService.getToolsHealth).toHaveBeenCalledTimes(1);
  });

  /**
   * El modo por defecto es el contrato OpenAPI, no el escaneo de código: la imagen desplegada no
   * copia `src/modules`, así que el escáner devolvía cero endpoints dentro de un contenedor.
   */
  it('descubrir usa el contrato OpenAPI por defecto', async () => {
    const { service, discovery, openApiCatalog } = build();
    await service.discoverEndpoints({ mode: 'OPENAPI_CONTRACT', persist: true } as never);
    expect(openApiCatalog.catalogFromContract).toHaveBeenCalledWith(true);
    expect(discovery.discoverAndMaybePersist).not.toHaveBeenCalled();
  });

  it('el escaneo de código sigue disponible cuando se pide explícitamente', async () => {
    const { service, discovery, openApiCatalog } = build();
    await service.discoverEndpoints({ mode: 'SOURCE_SCAN', persist: false } as never);
    expect(discovery.discoverAndMaybePersist).toHaveBeenCalledWith(false);
    expect(openApiCatalog.catalogFromContract).not.toHaveBeenCalled();
  });

  it('listDomains / listTools / listDataEntities mapean filas y propagan meta', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.listDomains as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, domainCode: 'D', domainName: 'Dom' }],
      meta: { page: 1 },
    } as never);
    (catalogRepository.listTools as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 2, code: 'T', name: 'Tool', type: 'api' }],
      meta: { page: 2 },
    } as never);
    (catalogRepository.listDataEntities as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 3, schemaName: 's', tableName: 't', entityName: 'E' }],
      meta: { page: 3 },
    } as never);
    expect((await service.listDomains({} as never)).items[0]).toMatchObject({ domainCode: 'D' });
    expect((await service.listTools({} as never)).items[0]).toMatchObject({ toolId: '2', code: 'T' });
    const entities = await service.listDataEntities({} as never);
    expect(entities.items[0]).toMatchObject({ entityId: '3' });
    expect(entities.meta).toEqual({ page: 3 });
  });

  it('getDomain devuelve el mapeo cuando existe', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findDomainByCode as jest.Mock).mockResolvedValueOnce({ id: 4, domainCode: 'DOM', domainName: 'Dominio' } as never);
    expect(await service.getDomain('DOM')).toMatchObject({ domainCode: 'DOM' });
  });

  it('updateDataEntityMetadata lanza NotFound o devuelve la entidad mapeada', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository as unknown as { updateDataEntityMetadata: jest.Mock }).updateDataEntityMetadata = jest.fn(
      async (..._args: unknown[]) => null,
    );
    await expect(service.updateDataEntityMetadata('7', { description: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    (catalogRepository as unknown as { updateDataEntityMetadata: jest.Mock }).updateDataEntityMetadata.mockResolvedValueOnce({
      id: 7,
      schemaName: 's',
      tableName: 't',
      entityName: 'E',
    } as never);
    expect(await service.updateDataEntityMetadata('7', { description: 'x' })).toMatchObject({ entityId: '7' });
  });

  it('getImpactByEndpoint agrega tools/tables/fields enriquecidos', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findEndpointById as jest.Mock).mockResolvedValueOnce({ id: 5, code: 'EP', method: 'GET' } as never);
    (catalogRepository.findToolRequirementsByEndpoint as jest.Mock).mockResolvedValueOnce([{ id: 1, toolId: 9 }] as never);
    (catalogRepository.findDataImpactsByEndpoint as jest.Mock).mockResolvedValueOnce([{ id: 1, dataEntityId: 7, endpointId: 5 }] as never);
    (catalogRepository.findFieldImpactsByEndpoint as jest.Mock).mockResolvedValueOnce([{ id: 1, dataEntityId: 7, endpointId: 5 }] as never);
    (catalogRepository.findToolsByIds as jest.Mock).mockResolvedValueOnce([{ id: 9, code: 'TOOL', name: 'Tool', type: 'api' }] as never);
    (catalogRepository.findDataEntitiesByIds as jest.Mock).mockResolvedValue([
      { id: 7, schemaName: 's', tableName: 't', entityName: 'E' },
    ] as never);
    const res = await service.getImpactByEndpoint('5');
    expect(res.endpoint).toMatchObject({ endpointId: '5' });
    expect(res.tools).toHaveLength(1);
    expect(res.tables).toHaveLength(1);
    expect(res.fields).toHaveLength(1);
  });

  it('getImpactByTable mapea también los fieldImpacts cuando existen', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findDataEntityByTable as jest.Mock).mockResolvedValueOnce({
      id: 7,
      schemaName: 's',
      tableName: 't',
      entityName: 'E',
    } as never);
    (catalogRepository.findFieldImpactsByDataEntity as jest.Mock).mockResolvedValueOnce([
      { id: 1, dataEntityId: 7, fieldName: 'x' },
    ] as never);
    const res = await service.getImpactByTable('s', 't');
    expect(res.fieldImpacts).toHaveLength(1);
  });

  it('getDashboard marca READY_FOR_REVIEW solo con endpoints y entidades presentes', async () => {
    const { service, dashboardRepository } = build();
    (dashboardRepository.getDashboardCounts as jest.Mock).mockResolvedValueOnce({
      endpoints: 5,
      dataEntities: 3,
      pendingReviews: 2,
      stressProfiles: 1,
    } as never);
    const ready = await service.getDashboard();
    expect(ready.posture).toMatchObject({ catalogCoverage: 'READY_FOR_REVIEW', pendingReviews: 2, stressProfilesEnabled: 1 });

    const { service: s2 } = build(); // counts en cero por defecto
    const needs = await s2.getDashboard();
    expect(needs.posture.catalogCoverage).toBe('NEEDS_SEED_REFRESH');
  });
});
