/**
 * @file El catálogo de METADATOS: campos, relaciones, reglas, dominios y contratos de payload.
 * @business Es lo que permite responder «qué toca este endpoint» sin abrir el código.
 * @system consulta las tablas de metadatos de systems-ops.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import {
  SystemDataEntityCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemToolCatalogModel,
  SystemDataFieldCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemOperationalRuleCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointPayloadContractModel,
} from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';

export type UpsertDataImpactInput = {
  endpointId: string;
  dataEntityId: string;
  operationType: string;
  impactLevel: string;
  isPrimaryEntity?: boolean;
  affectsCustomerState?: boolean;
  affectsFinancialState?: boolean;
  affectsRiskState?: boolean;
  affectsLegalState?: boolean;
  affectsDeviceState?: boolean;
  affectsNotificationState?: boolean;
  requiresStressTest?: boolean;
  notes?: string | null;
  detectedFrom?: string;
  confidenceLevel?: string;
  reviewStatus?: string;
};

/**
 * Sale de `SystemsCatalogRepository` porque aquel archivo llevaba dos catálogos en uno: las
 * ENTIDADES —endpoints, herramientas y tablas, que se dan de alta y se actualizan— y los METADATOS
 * que las describen y las relacionan, que sólo se leen. Con 548 líneas era casi el doble del límite
 * de `check:file-size`, y la mitad de las consultas no tenían nada que ver con la otra mitad.
 */
@Injectable()
export class SystemsMetadataRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemDataFieldCatalogModel) private readonly dataFieldModel: typeof SystemDataFieldCatalogModel,
    @InjectModel(SystemDataRelationshipCatalogModel) private readonly relationshipModel: typeof SystemDataRelationshipCatalogModel,
    @InjectModel(SystemOperationalRuleCatalogModel) private readonly operationalRuleModel: typeof SystemOperationalRuleCatalogModel,
    @InjectModel(SystemDomainCatalogModel) private readonly domainModel: typeof SystemDomainCatalogModel,
    @InjectModel(SystemEndpointPayloadContractModel) private readonly payloadContractModel: typeof SystemEndpointPayloadContractModel,
  ) {}

  findToolRequirementsByEndpoint(endpointId: string): Promise<SystemEndpointToolRequirementModel[]> {
    return this.endpointToolModel.findAll({ where: { endpointId }, order: [['id', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEndpoint(endpointId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { endpointId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  findFieldImpactsByEndpoint(endpointId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { endpointId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findFieldImpactsByDataEntity(dataEntityId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { dataEntityId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEntity(dataEntityId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { dataEntityId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

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

  findPayloadContractsByEndpoint(endpointId: string): Promise<SystemEndpointPayloadContractModel[]> {
    return this.payloadContractModel.findAll({
      where: { endpointId },
      order: [
        ['contractType', 'ASC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  async upsertDataImpact(values: UpsertDataImpactInput): Promise<void> {
    const now = new Date();
    await this.dataImpactModel.upsert({
      endpointId: values.endpointId,
      dataEntityId: values.dataEntityId,
      operationType: values.operationType,
      impactLevel: values.impactLevel,
      isPrimaryEntity: values.isPrimaryEntity ?? false,
      isTransactional: values.operationType !== 'READ',
      rollbackRequired: values.operationType !== 'READ',
      affectsCustomerState: values.affectsCustomerState ?? false,
      affectsFinancialState: values.affectsFinancialState ?? false,
      affectsRiskState: values.affectsRiskState ?? false,
      affectsLegalState: values.affectsLegalState ?? false,
      affectsDeviceState: values.affectsDeviceState ?? false,
      affectsNotificationState: values.affectsNotificationState ?? false,
      requiresAuditLog: true,
      requiresRegressionTest: values.operationType !== 'READ',
      requiresStressTest: values.requiresStressTest ?? false,
      notes: values.notes ?? null,
      detectedFrom: values.detectedFrom ?? 'docs',
      confidenceLevel: values.confidenceLevel ?? 'MEDIUM',
      reviewStatus: values.reviewStatus ?? 'NEEDS_REVIEW',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }
}
