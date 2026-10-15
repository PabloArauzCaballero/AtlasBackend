/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Mantiene el catálogo de herramientas de prueba y operación disponibles.
 * @system lista, busca y upserta herramientas del catálogo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemToolCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';
import { ToolSeed } from './systems-ops.types.js';
import { buildToolRow } from './systems-catalog-rows.js';
import { buildToolWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemToolCatalogRepository {
  constructor(@InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel) {}

  async listTools(query: SystemsListQueryDto) {
    const result = await this.toolModel.findAndCountAll({
      where: buildToolWhere(query),
      order: [['code', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findToolById(toolId: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findByPk(toolId);
  }

  findToolByCode(code: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findOne({ where: { code } } as FindOptions);
  }

  findToolsByIds(toolIds: string[]): Promise<SystemToolCatalogModel[]> {
    if (toolIds.length === 0) return Promise.resolve([]);
    return this.toolModel.findAll({ where: { id: { [Op.in]: toolIds } } } as FindOptions);
  }

  async upsertTool(seed: ToolSeed): Promise<void> {
    const now = new Date();
    await this.toolModel.upsert(buildToolRow(seed, now) as never);
  }
}
