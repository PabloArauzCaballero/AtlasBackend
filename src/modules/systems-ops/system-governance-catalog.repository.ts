/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Expone las reglas operativas y los dominios de negocio que gobiernan el catálogo de sistemas.
 * @system consulta system_operational_rule_catalog y system_domain_catalog.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemDomainCatalogModel, SystemOperationalRuleCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';

@Injectable()
export class SystemGovernanceCatalogRepository {
  constructor(
    @InjectModel(SystemOperationalRuleCatalogModel) private readonly operationalRuleModel: typeof SystemOperationalRuleCatalogModel,
    @InjectModel(SystemDomainCatalogModel) private readonly domainModel: typeof SystemDomainCatalogModel,
  ) {}

  async listOperationalRules(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.operationalRuleModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { ruleCode: { [Op.iLike]: `%${search}%` } },
              { tableName: { [Op.iLike]: `%${search}%` } },
              { endpointCode: { [Op.iLike]: `%${search}%` } },
              { description: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['scopeType', 'ASC'],
        ['ruleType', 'ASC'],
        ['ruleCode', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findOperationalRulesByTable(schemaName: string, tableName: string): Promise<SystemOperationalRuleCatalogModel[]> {
    return this.operationalRuleModel.findAll({
      where: { schemaName, tableName },
      order: [
        ['severity', 'DESC'],
        ['ruleType', 'ASC'],
      ],
    } as FindOptions);
  }

  async listDomains(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.domainModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { domainCode: { [Op.iLike]: `%${search}%` } },
              { domainName: { [Op.iLike]: `%${search}%` } },
              { description: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [['domainCode', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findDomainByCode(domainCode: string): Promise<SystemDomainCatalogModel | null> {
    return this.domainModel.findOne({ where: { domainCode } } as FindOptions);
  }
}
