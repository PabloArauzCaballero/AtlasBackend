/**
 * @file Caso de uso de lectura: los ítems propuestos por una ingesta que esperan decisión.
 * @business Esta pieza hace posible revisar una ingesta de catálogo desde el portal: sin ver los ítems propuestos no hay nada que aprobar ni rechazar.
 * @system lista paginada de `context_staging_items`, por catálogo y estado de revisión, con el mismo DTO que ya devuelve la decisión en lote.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, WhereOptions } from 'sequelize';
import { ContextCatalogModel, ContextStagingItemModel } from '../../../database/models/index.js';
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

  async list(query: ListStagingItemsQueryDto) {
    const where: WhereOptions = {};
    if (query.catalogCode) {
      const catalog = await this.catalogs.findOne({ where: { catalogCode: query.catalogCode } } as FindOptions);
      if (!catalog) throw new NotFoundException({ code: 'CATALOG_NOT_FOUND', catalogCode: query.catalogCode });
      Object.assign(where, { catalogId: catalog.id });
    }
    if (query.reviewStatus) Object.assign(where, { reviewStatus: query.reviewStatus });
    if (query.ingestionJobId) Object.assign(where, { ingestionJobId: query.ingestionJobId });
    const { rows, count } = await this.items.findAndCountAll({
      where,
      order: [['_id', 'DESC']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    } as FindOptions);
    return { items: rows.map(stagingItemDto), total: count, page: query.page, pageSize: query.pageSize };
  }
}
