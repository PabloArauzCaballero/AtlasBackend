/**
 * @file Caso de uso de lectura: los ítems propuestos por una ingesta que esperan decisión.
 * @business Esta pieza hace posible revisar una ingesta de catálogo desde el portal: sin ver los ítems propuestos no hay nada que aprobar ni rechazar.
 * @system lista paginada de `context_staging_items`, por catálogo y estado de revisión, con el mismo DTO que ya devuelve la decisión en lote.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, WhereOptions } from 'sequelize';
import { ContextCatalogModel, ContextStagingItemModel } from '../../../database/models/index.js';
import { buildPaginationMeta, toOffset } from '../../../common/utils/pagination/pagination.util.js';
import { withTextSearch } from '../../../common/utils/query/text-search.util.js';
import { stagingItemDto } from '../catalog-management.mapper.js';
import type { ListStagingItemsQueryDto } from '../catalog-staging.schemas.js';

/**
 * `POST catalog-staging-items/decision-batch` pedía ids que ninguna ruta enseñaba: la ingesta sólo
 * devuelve cuántos ítems creó. Esta lectura es lo que le faltaba a la decisión para ser usable.
 */
@Injectable()
export class CatalogStagingReadService {
  constructor(
    @InjectModel(ContextStagingItemModel) private readonly items: typeof ContextStagingItemModel,
    @InjectModel(ContextCatalogModel) private readonly catalogs: typeof ContextCatalogModel,
  ) {}

  /**
   * Una página de los ítems, filtrada y con el total del filtro (`meta`).
   *
   * `summary` cuenta el ALCANCE (el catálogo y, si se pidió, la ingesta) entero, sin el buscador ni
   * el estado ni «sugerido por IA»: las cifras no cambian al buscar. `total`, `page` y `pageSize`
   * se conservan tal cual para quien ya los leía.
   */
  async list(query: ListStagingItemsQueryDto) {
    const scope: WhereOptions = {};
    if (query.catalogCode) {
      const catalog = await this.catalogs.findOne({ where: { catalogCode: query.catalogCode } } as FindOptions);
      if (!catalog) throw new NotFoundException({ code: 'CATALOG_NOT_FOUND', catalogCode: query.catalogCode });
      Object.assign(scope, { catalogId: catalog.id });
    }
    if (query.ingestionJobId) Object.assign(scope, { ingestionJobId: query.ingestionJobId });
    const where: Record<string | symbol, unknown> = { ...scope };
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.aiSuggested !== undefined) where.aiSuggested = query.aiSuggested;
    withTextSearch(where, query.q, ['proposedItemCode', 'proposedItemName'], ['_id']);
    const limit = query.limit ?? query.pageSize;
    const [{ rows, count }, total, pendingReview, approved, rejected, aiSuggested] = await Promise.all([
      this.items.findAndCountAll({
        where,
        order: [['_id', 'DESC']],
        limit,
        offset: toOffset({ page: query.page, limit }),
      } as FindOptions),
      this.items.count({ where: scope } as FindOptions),
      this.items.count({ where: { ...scope, reviewStatus: 'pending_review' } } as FindOptions),
      this.items.count({ where: { ...scope, reviewStatus: 'approved' } } as FindOptions),
      this.items.count({ where: { ...scope, reviewStatus: 'rejected' } } as FindOptions),
      this.items.count({ where: { ...scope, aiSuggested: true } } as FindOptions),
    ]);
    return {
      items: rows.map(stagingItemDto),
      total: count,
      page: query.page,
      pageSize: limit,
      meta: buildPaginationMeta({ page: query.page, limit }, count),
      summary: { total, pendingReview, approved, rejected, aiSuggested },
    };
  }
}
