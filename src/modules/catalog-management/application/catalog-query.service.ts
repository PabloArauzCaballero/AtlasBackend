/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { buildPaginationMeta } from '../../../common/utils/pagination/pagination.util.js';
import { catalogDto, catalogVersionDto, contextItemDto } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { ListCatalogsQueryDto } from '../catalog-management.schemas.js';
import { assertInternal } from './catalog-management.shared.js';

@Injectable()
export class CatalogQueryService {
  constructor(private readonly repository: CatalogManagementRepository) {}

  /**
   * El estado de versión ya lo filtra la consulta (contra la versión más reciente, en SQL); aquí sólo
   * se adjunta esa versión a cada fila de la página. `meta` y `summary` cuentan el filtro entero.
   */
  async listCatalogs(input: { query: ListCatalogsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const page = await this.repository.listCatalogs(input.query);
    // Batch: una sola query trae la última versión de TODOS los catálogos de la página, en vez de un
    // `findLatestVersion` por catálogo (N+1).
    const latestVersionsByCatalogId = await this.repository.findLatestVersionsByCatalogIds(page.rows.map((catalog) => String(catalog.id)));
    return {
      items: page.rows.map((catalog) => catalogDto(catalog, latestVersionsByCatalogId.get(String(catalog.id)) ?? null)),
      meta: buildPaginationMeta({ page: input.query.page, limit: input.query.limit }, page.total),
      summary: page.summary,
    };
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
