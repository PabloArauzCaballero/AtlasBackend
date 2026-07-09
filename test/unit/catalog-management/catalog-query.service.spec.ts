import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9): último
 * servicio de `catalog-management` — con este archivo, los 6 servicios del módulo quedan
 * cubiertos. El caso más importante es el filtro de `listCatalogs`: un catálogo se excluye del
 * listado si el estado de su versión más reciente no coincide con el filtro pedido, salvo que
 * el filtro sea literalmente `'all'`.
 */
jest.mock('../../../src/modules/catalog-management/catalog-management.mapper.js', () => ({
  catalogDto: jest.fn((catalog: unknown, version: unknown) => ({ catalog, version, mapped: 'catalog' })),
  catalogVersionDto: jest.fn((version: unknown) => ({ version, mapped: 'version' })),
  contextItemDto: jest.fn((item: { id: string }, aliases: unknown[], mappings: unknown[]) => ({ id: item.id, aliases, mappings })),
}));

describe('CatalogQueryService', () => {
  async function buildService() {
    const { CatalogQueryService } = await import('../../../src/modules/catalog-management/application/catalog-query.service.js');
    const repository = {
      listCatalogs: jest.fn(),
      findLatestVersion: jest.fn(),
      findCatalogByCode: jest.fn(),
      findCatalogVersion: jest.fn(),
      findItemsByVersion: jest.fn(),
      findAliasesByItemIds: jest.fn(),
      findRiskMappingsByItemIds: jest.fn(),
    };
    const service = new CatalogQueryService(repository as never);
    return { service, repository };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;
  const customerUser = { role: 'customer', internalUserId: null, platformUserId: null } as never;

  describe('listCatalogs', () => {
    it('rejects a non-internal actor', async () => {
      const { service } = await buildService();
      await expect(service.listCatalogs({ query: { status: 'all' } as never, currentUser: customerUser })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('status: "all" includes catalogs regardless of their current version status', async () => {
      const { service, repository } = await buildService();
      (repository.listCatalogs as jest.Mock).mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }] as never);
      (repository.findLatestVersion as jest.Mock)
        .mockResolvedValueOnce({ status: 'draft' } as never)
        .mockResolvedValueOnce({ status: 'published' } as never);

      const result = await service.listCatalogs({ query: { status: 'all' } as never, currentUser: internalUser });

      expect(result.items).toHaveLength(2);
    });

    it('a specific status filter excludes catalogs whose current version does not match', async () => {
      const { service, repository } = await buildService();
      (repository.listCatalogs as jest.Mock).mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }] as never);
      (repository.findLatestVersion as jest.Mock)
        .mockResolvedValueOnce({ status: 'published' } as never)
        .mockResolvedValueOnce({ status: 'draft' } as never);

      const result = await service.listCatalogs({ query: { status: 'published' } as never, currentUser: internalUser });

      expect(result.items).toHaveLength(1);
    });

    it('a catalog with no version at all is excluded by any specific status filter (undefined !== filter)', async () => {
      const { service, repository } = await buildService();
      (repository.listCatalogs as jest.Mock).mockResolvedValueOnce([{ id: 'c1' }] as never);
      (repository.findLatestVersion as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.listCatalogs({ query: { status: 'published' } as never, currentUser: internalUser });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('getCatalogVersion', () => {
    it('throws NotFoundException when the catalog does not exist', async () => {
      const { service, repository } = await buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getCatalogVersion({ catalogCode: 'missing', versionId: 'v1', currentUser: internalUser })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the version does not exist', async () => {
      const { service, repository } = await buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getCatalogVersion({ catalogCode: 'c1', versionId: 'missing', currentUser: internalUser })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('attaches only the aliases/mappings belonging to each specific item, not a global mixed list', async () => {
      const { service, repository } = await buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 'v1' } as never);
      (repository.findItemsByVersion as jest.Mock).mockResolvedValueOnce([{ id: 'item-1' }, { id: 'item-2' }] as never);
      (repository.findAliasesByItemIds as jest.Mock).mockResolvedValueOnce([
        { contextItemId: 'item-1', aliasValue: 'a1' },
        { contextItemId: 'item-2', aliasValue: 'a2' },
      ] as never);
      (repository.findRiskMappingsByItemIds as jest.Mock).mockResolvedValueOnce([{ contextItemId: 'item-1', riskDimension: 'd' }] as never);

      const result = await service.getCatalogVersion({ catalogCode: 'c1', versionId: 'v1', currentUser: internalUser });

      const item1 = result.items.find((i: { id: string }) => i.id === 'item-1') as { aliases: unknown[]; mappings: unknown[] };
      const item2 = result.items.find((i: { id: string }) => i.id === 'item-2') as { aliases: unknown[]; mappings: unknown[] };
      expect(item1.aliases).toHaveLength(1);
      expect(item1.mappings).toHaveLength(1);
      expect(item2.aliases).toHaveLength(1);
      expect(item2.mappings).toHaveLength(0);
    });
  });
});
