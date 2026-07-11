import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { catalogDto, catalogVersionDto, contextItemDto } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { ListCatalogsQueryDto } from '../catalog-management.schemas.js';
import { assertInternal } from './catalog-management.shared.js';

@Injectable()
export class CatalogQueryService {
  constructor(private readonly repository: CatalogManagementRepository) {}

  async listCatalogs(input: { query: ListCatalogsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const catalogs = await this.repository.listCatalogs(input.query);
    // Batch: una sola query trae la última versión de TODOS los catálogos listados, en vez de un
    // `findLatestVersion` por catálogo (N+1 — antes, un tenant con muchos catálogos disparaba un
    // round trip extra por fila devuelta).
    const latestVersionsByCatalogId = await this.repository.findLatestVersionsByCatalogIds(catalogs.map((catalog) => String(catalog.id)));
    const rows = catalogs
      .map((catalog) => {
        const currentVersion = latestVersionsByCatalogId.get(String(catalog.id)) ?? null;
        if (input.query.status !== 'all' && currentVersion?.status !== input.query.status) return null;
        return catalogDto(catalog, currentVersion);
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return { items: rows };
  }

  async getCatalogVersion(input: { catalogCode: string; versionId: string; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const catalog = await this.repository.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.repository.findCatalogVersion(String(catalog.id), input.versionId);
    if (!version) throw new NotFoundException('Versión de catálogo no encontrada.');
    const items = await this.repository.findItemsByVersion(String(version.id));
    const itemIds = items.map((item) => String(item.id));
    const [aliases, mappings] = await Promise.all([
      this.repository.findAliasesByItemIds(itemIds),
      this.repository.findRiskMappingsByItemIds(itemIds),
    ]);
    return {
      catalog: catalogDto(catalog, version),
      version: catalogVersionDto(version),
      items: items.map((item) =>
        contextItemDto(
          item,
          aliases.filter((alias) => String(alias.contextItemId) === String(item.id)),
          mappings.filter((mapping) => String(mapping.contextItemId) === String(item.id)),
        ),
      ),
    };
  }
}
