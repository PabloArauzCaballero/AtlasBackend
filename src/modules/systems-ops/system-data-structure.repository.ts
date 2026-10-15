/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Describe la estructura de los datos: campos de cada tabla y relaciones entre tablas.
 * @system consulta system_data_field_catalog y system_data_relationship_catalog.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemDataFieldCatalogModel, SystemDataRelationshipCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';

@Injectable()
export class SystemDataStructureRepository {
  constructor(
    @InjectModel(SystemDataFieldCatalogModel) private readonly dataFieldModel: typeof SystemDataFieldCatalogModel,
    @InjectModel(SystemDataRelationshipCatalogModel) private readonly relationshipModel: typeof SystemDataRelationshipCatalogModel,
  ) {}

  async listDataFields(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.dataFieldModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { tableName: { [Op.iLike]: `%${search}%` } },
              { columnName: { [Op.iLike]: `%${search}%` } },
              { businessMeaning: { [Op.iLike]: `%${search}%` } },
              { domainCode: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['tableName', 'ASC'],
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findFieldsByEntity(dataEntityId: string): Promise<SystemDataFieldCatalogModel[]> {
    return this.dataFieldModel.findAll({
      where: { dataEntityId },
      order: [
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
    } as FindOptions);
  }

  findFieldsByTable(schemaName: string, tableName: string): Promise<SystemDataFieldCatalogModel[]> {
    return this.dataFieldModel.findAll({
      where: { schemaName, tableName },
      order: [
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
    } as FindOptions);
  }

  async listRelationships(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.relationshipModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { sourceTable: { [Op.iLike]: `%${search}%` } },
              { targetTable: { [Op.iLike]: `%${search}%` } },
              { businessReason: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['sourceTable', 'ASC'],
        ['targetTable', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  async findRelationshipsByTable(schemaName: string, tableName: string): Promise<SystemDataRelationshipCatalogModel[]> {
    return this.relationshipModel.findAll({
      where: {
        [Op.or]: [
          { sourceSchema: schemaName, sourceTable: tableName },
          { targetSchema: schemaName, targetTable: tableName },
        ],
      },
      order: [
        ['sourceTable', 'ASC'],
        ['targetTable', 'ASC'],
      ],
    } as FindOptions);
  }
}
