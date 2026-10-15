/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Mantiene el catálogo de entidades de datos (tablas) y su narrativa de negocio.
 * @system lista, busca y upserta entidades de datos del catálogo; el detalle usa el modelo sin alcance para traer la narrativa larga.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemDataEntityCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';
import { DataEntitySeed } from './systems-ops.types.js';
import { buildDataEntityRow } from './systems-catalog-rows.js';
import { buildDataEntityWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemDataEntityCatalogRepository {
  constructor(@InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel) {}

  async listDataEntities(query: SystemsListQueryDto) {
    const result = await this.dataEntityModel.findAndCountAll({
      where: buildDataEntityWhere(query),
      order: [
        ['module', 'ASC'],
        ['tableName', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findDataEntityById(entityId: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.unscoped().findByPk(entityId); // unscoped: el detalle sí muestra la narrativa larga.
  }

  findDataEntityByTable(schemaName: string, tableName: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.unscoped().findOne({ where: { schemaName, tableName } } as FindOptions);
  }

  findDataEntitiesByIds(entityIds: string[]): Promise<SystemDataEntityCatalogModel[]> {
    if (entityIds.length === 0) return Promise.resolve([]);
    return this.dataEntityModel.findAll({ where: { id: { [Op.in]: entityIds } } } as FindOptions);
  }

  async upsertDataEntity(seed: DataEntitySeed): Promise<void> {
    const now = new Date();
    await this.dataEntityModel.upsert(buildDataEntityRow(seed, now) as never);
  }
}
