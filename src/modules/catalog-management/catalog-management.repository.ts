import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction, WhereOptions } from 'sequelize';
import {
  AttributeDefinitionModel,
  ContextApprovalEventModel,
  ContextCatalogModel,
  ContextCatalogVersionModel,
  ContextIngestionJobModel,
  ContextItemAliasModel,
  ContextItemModel,
  ContextRiskMappingModel,
  ContextSourceModel,
  ContextStagingItemModel,
  DataChangeLogModel,
  DataClassificationPolicyModel,
  DataProviderModel,
  DataQualityRuleModel,
  EventDefinitionModel,
  FeatureDefinitionModel,
  ObservationDefinitionModel,
  OperationalAuditLogModel,
  PrivacyProcessingPurposeModel,
  RetentionPolicyModel,
  RiskModelVersionModel,
  RiskPolicyRuleModel,
  RiskRulesetVersionModel,
  RiskSignalSeedModel,
  SensitiveFieldRuleModel,
} from '../../database/models/index.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { DefinitionsQueryDto, ListCatalogsQueryDto } from './catalog-management.schemas.js';

export type RepositoryOptions = { transaction?: Transaction };

export type AuditValues = {
  tenantId: string;
  actorType: string;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type DataChangeValues = {
  tenantId: string;
  tableName: string;
  recordId: string | null;
  changeType: string;
  actorType: string;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  reason: string;
  newValues?: Record<string, unknown>;
  happenedAt: Date;
};

function hashPayload(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null;
  return sha256Hex(JSON.stringify(value));
}

@Injectable()
export class CatalogManagementRepository {
  constructor(
    @InjectModel(ContextCatalogModel) private readonly catalogModel: typeof ContextCatalogModel,
    @InjectModel(ContextCatalogVersionModel) private readonly catalogVersionModel: typeof ContextCatalogVersionModel,
    @InjectModel(ContextItemModel) private readonly contextItemModel: typeof ContextItemModel,
    @InjectModel(ContextItemAliasModel) private readonly contextItemAliasModel: typeof ContextItemAliasModel,
    @InjectModel(ContextRiskMappingModel) private readonly contextRiskMappingModel: typeof ContextRiskMappingModel,
    @InjectModel(ContextSourceModel) private readonly contextSourceModel: typeof ContextSourceModel,
    @InjectModel(ContextStagingItemModel) private readonly contextStagingItemModel: typeof ContextStagingItemModel,
    @InjectModel(ContextApprovalEventModel) private readonly contextApprovalEventModel: typeof ContextApprovalEventModel,
    @InjectModel(ContextIngestionJobModel) private readonly contextIngestionJobModel: typeof ContextIngestionJobModel,
    @InjectModel(ObservationDefinitionModel) private readonly observationDefinitionModel: typeof ObservationDefinitionModel,
    @InjectModel(EventDefinitionModel) private readonly eventDefinitionModel: typeof EventDefinitionModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitionModel: typeof AttributeDefinitionModel,
    @InjectModel(FeatureDefinitionModel) private readonly featureDefinitionModel: typeof FeatureDefinitionModel,
    @InjectModel(RiskModelVersionModel) private readonly riskModelVersionModel: typeof RiskModelVersionModel,
    @InjectModel(RiskRulesetVersionModel) private readonly riskRulesetVersionModel: typeof RiskRulesetVersionModel,
    @InjectModel(RiskPolicyRuleModel) private readonly riskPolicyRuleModel: typeof RiskPolicyRuleModel,
    @InjectModel(RiskSignalSeedModel) private readonly riskSignalSeedModel: typeof RiskSignalSeedModel,
    @InjectModel(PrivacyProcessingPurposeModel) private readonly privacyPurposeModel: typeof PrivacyProcessingPurposeModel,
    @InjectModel(RetentionPolicyModel) private readonly retentionPolicyModel: typeof RetentionPolicyModel,
    @InjectModel(DataProviderModel) private readonly dataProviderModel: typeof DataProviderModel,
    @InjectModel(DataClassificationPolicyModel) private readonly classificationPolicyModel: typeof DataClassificationPolicyModel,
    @InjectModel(SensitiveFieldRuleModel) private readonly sensitiveFieldRuleModel: typeof SensitiveFieldRuleModel,
    @InjectModel(DataQualityRuleModel) private readonly dataQualityRuleModel: typeof DataQualityRuleModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  listCatalogs(query: ListCatalogsQueryDto): Promise<ContextCatalogModel[]> {
    const where: WhereOptions = {
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.active === 'true' ? { isActive: true } : {}),
      ...(query.active === 'false' ? { isActive: false } : {}),
    };
    return this.catalogModel.findAll({ where, order: [['catalogCode', 'ASC']] } as FindOptions);
  }

  findCatalogByCode(catalogCode: string, options: RepositoryOptions = {}): Promise<ContextCatalogModel | null> {
    return this.catalogModel.findOne({ where: { catalogCode }, transaction: options.transaction } as FindOptions);
  }

  findLatestVersion(catalogId: string): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({
      where: { catalogId },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  /**
   * Batch de `findLatestVersion` para varios catálogos a la vez — usada por
   * `CatalogQueryService.listCatalogs` para no disparar un `findLatestVersion` por catálogo
   * listado (N+1). Trae todas las versiones de los catálogos pedidos en una sola query, ya
   * ordenadas por catálogo y fecha, y arma en memoria un mapa catalogId -> versión más reciente.
   */
  async findLatestVersionsByCatalogIds(catalogIds: readonly string[]): Promise<Map<string, ContextCatalogVersionModel>> {
    if (catalogIds.length === 0) return new Map();
    const versions = await this.catalogVersionModel.findAll({
      where: { catalogId: { [Op.in]: [...catalogIds] } } as WhereOptions,
      order: [
        ['catalogId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);

    const latestByCatalogId = new Map<string, ContextCatalogVersionModel>();
    for (const version of versions) {
      const catalogId = String(version.catalogId);
      if (!latestByCatalogId.has(catalogId)) {
        latestByCatalogId.set(catalogId, version);
      }
    }
    return latestByCatalogId;
  }

  findCatalogVersion(catalogId: string, versionId: string, options: RepositoryOptions = {}): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({ where: { id: versionId, catalogId }, transaction: options.transaction } as FindOptions);
  }

  findCatalogVersionById(versionId: string, options: RepositoryOptions = {}): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({ where: { id: versionId }, transaction: options.transaction } as FindOptions);
  }

  findItemsByVersion(catalogVersionId: string, options: RepositoryOptions = {}): Promise<ContextItemModel[]> {
    return this.contextItemModel.findAll({
      where: { catalogVersionId },
      order: [['itemCode', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findAliasesByItemIds(itemIds: string[], options: RepositoryOptions = {}): Promise<ContextItemAliasModel[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return this.contextItemAliasModel.findAll({
      where: { contextItemId: { [Op.in]: itemIds } },
      order: [['aliasValue', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findRiskMappingsByItemIds(itemIds: string[], options: RepositoryOptions = {}): Promise<ContextRiskMappingModel[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return this.contextRiskMappingModel.findAll({
      where: { contextItemId: { [Op.in]: itemIds } },
      order: [['riskDimension', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findSourceByCode(sourceCode: string, options: RepositoryOptions = {}): Promise<ContextSourceModel | null> {
    return this.contextSourceModel.findOne({ where: { sourceCode }, transaction: options.transaction } as FindOptions);
  }

  createSource(
    values: { sourceCode: string; sourceName: string; sourceType: string; reliabilityScore?: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<ContextSourceModel> {
    return this.contextSourceModel.create(
      {
        sourceCode: values.sourceCode,
        sourceName: values.sourceName,
        sourceType: values.sourceType,
        reliabilityScore: values.reliabilityScore ?? null,
        refreshFrequency: null,
        notes: null,
        isActive: true,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createCatalogVersion(
    values: {
      catalogId: string;
      versionCode: string;
      status: string;
      validFrom: string | null;
      validUntil: string | null;
      createdByType: string;
      createdByPlatformUserId: string | null;
      notes: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextCatalogVersionModel> {
    return this.catalogVersionModel.create(
      {
        catalogId: values.catalogId,
        versionCode: values.versionCode,
        status: values.status,
        validFrom: values.validFrom,
        validUntil: values.validUntil,
        createdByType: values.createdByType,
        createdByPlatformUserId: values.createdByPlatformUserId,
        approvedByType: null,
        approvedByPlatformUserId: null,
        approvedAt: null,
        notes: values.notes,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createContextItem(
    values: {
      catalogVersionId: string;
      itemCode: string;
      itemName: string;
      itemType: string;
      attributes: Record<string, unknown>;
      sourceId: string | null;
      confidenceScore: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextItemModel> {
    return this.contextItemModel.create(
      {
        catalogVersionId: values.catalogVersionId,
        itemCode: values.itemCode,
        itemName: values.itemName,
        itemType: values.itemType,
        attributesJson: values.attributes,
        sourceId: values.sourceId,
        confidenceScore: values.confidenceScore,
        isActive: true,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createAlias(
    values: {
      contextItemId: string;
      aliasValue: string;
      aliasType: string;
      normalizedAlias: string;
      confidenceScore: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextItemAliasModel> {
    return this.contextItemAliasModel.create(
      {
        contextItemId: values.contextItemId,
        aliasValue: values.aliasValue,
        aliasType: values.aliasType,
        normalizedAlias: values.normalizedAlias,
        confidenceScore: values.confidenceScore,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createRiskMapping(
    values: {
      contextItemId: string;
      riskDimension: string;
      riskBand: string;
      scorePointsSuggested: string | null;
      reasonCode: string;
      explanation: string | null;
      modelUsage: string | null;
      validFrom: string | null;
      validUntil: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextRiskMappingModel> {
    return this.contextRiskMappingModel.create(
      {
        contextItemId: values.contextItemId,
        riskDimension: values.riskDimension,
        riskBand: values.riskBand,
        scorePointsSuggested: values.scorePointsSuggested,
        reasonCode: values.reasonCode,
        explanation: values.explanation,
        modelUsage: values.modelUsage,
        validFrom: values.validFrom,
        validUntil: values.validUntil,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  async updateCatalogVersionStatus(
    version: ContextCatalogVersionModel,
    values: {
      status: string;
      notes?: string | null;
      approvedByType?: string | null;
      approvedByPlatformUserId?: string | null;
      approvedAt?: Date | null;
      validFrom?: string | null;
      validUntil?: string | null;
    },
    options: RepositoryOptions,
  ): Promise<ContextCatalogVersionModel> {
    version.status = values.status;
    if (values.notes !== undefined) version.notes = values.notes;
    if (values.approvedByType !== undefined) version.approvedByType = values.approvedByType;
    if (values.approvedByPlatformUserId !== undefined) version.approvedByPlatformUserId = values.approvedByPlatformUserId;
    if (values.approvedAt !== undefined) version.approvedAt = values.approvedAt;
    if (values.validFrom !== undefined) version.validFrom = values.validFrom;
    if (values.validUntil !== undefined) version.validUntil = values.validUntil;
    return version.save({ transaction: options.transaction });
  }

  createApprovalEvent(
    values: {
      stagingItemId: string | null;
      catalogVersionId: string | null;
      eventType: string;
      decidedByPlatformUserId: string | null;
      decidedAt: Date;
      decisionReason: string;
    },
    options: RepositoryOptions,
  ): Promise<ContextApprovalEventModel> {
    return this.contextApprovalEventModel.create(
      {
        stagingItemId: values.stagingItemId,
        catalogVersionId: values.catalogVersionId,
        eventType: values.eventType,
        decidedByPlatformUserId: values.decidedByPlatformUserId,
        decidedAt: values.decidedAt,
        decisionReason: values.decisionReason,
        createdAtValue: values.decidedAt,
      } as any,
      { transaction: options.transaction },
    );
  }

  createIngestionJob(
    values: {
      jobCode: string;
      sourceType: string;
      sourceName: string;
      triggeredByType: string;
      triggeredByPlatformUserId: string | null;
      status: string;
      summary: Record<string, unknown>;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextIngestionJobModel> {
    return this.contextIngestionJobModel.create(
      {
        jobCode: values.jobCode,
        sourceType: values.sourceType,
        sourceName: values.sourceName,
        triggeredByType: values.triggeredByType,
        triggeredByPlatformUserId: values.triggeredByPlatformUserId,
        status: values.status,
        startedAt: values.now,
        finishedAt: values.now,
        summaryJson: values.summary,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createStagingItem(
    values: {
      catalogId: string;
      ingestionJobId: string;
      proposedItemCode: string | null;
      proposedItemName: string;
      proposedAttributes: Record<string, unknown>;
      aiSuggested: boolean;
      createdByType: string;
      createdByPlatformUserId: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextStagingItemModel> {
    return this.contextStagingItemModel.create(
      {
        catalogId: values.catalogId,
        ingestionJobId: values.ingestionJobId,
        proposedItemCode: values.proposedItemCode,
        proposedItemName: values.proposedItemName,
        proposedAttributesJson: values.proposedAttributes,
        aiSuggested: values.aiSuggested,
        reviewStatus: 'pending_review',
        reviewNotes: null,
        createdByType: values.createdByType,
        createdByPlatformUserId: values.createdByPlatformUserId,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  findStagingItemById(stagingItemId: string, options: RepositoryOptions = {}): Promise<ContextStagingItemModel | null> {
    return this.contextStagingItemModel.findOne({ where: { id: stagingItemId }, transaction: options.transaction } as FindOptions);
  }

  async updateStagingItemDecision(
    item: ContextStagingItemModel,
    values: { reviewStatus: string; reviewNotes: string; now: Date },
    options: RepositoryOptions,
  ): Promise<ContextStagingItemModel> {
    item.reviewStatus = values.reviewStatus;
    item.reviewNotes = values.reviewNotes;
    item.updatedAtValue = values.now;
    return item.save({ transaction: options.transaction });
  }

  async listDefinitions(query: DefinitionsQueryDto) {
    const statusWhere = query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {};
    const domainFilter = query.domain ? query.domain : undefined;
    const [observations, events, attributes, features] = await Promise.all([
      query.type === 'all' || query.type === 'observation'
        ? this.observationDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { sourceGroup: domainFilter } : {}) },
            order: [['observationCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'event'
        ? this.eventDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { eventFamily: domainFilter } : {}) },
            order: [['eventCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'attribute'
        ? this.attributeDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { sourceType: domainFilter } : {}) },
            order: [['attributeCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'feature'
        ? this.featureDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { featureFamily: domainFilter } : {}) },
            order: [['featureCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
    ]);
    return { observations, events, attributes, features };
  }

  upsertEventDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.eventDefinitionModel, 'eventCode', values.eventCode as string, values, options);
  }
  upsertObservationDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.observationDefinitionModel, 'observationCode', values.observationCode as string, values, options);
  }
  upsertAttributeDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.attributeDefinitionModel, 'attributeCode', values.attributeCode as string, values, options);
  }
  upsertFeatureDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.featureDefinitionModel, 'featureCode', values.featureCode as string, values, options);
  }

  async upsertByCode<T extends { update: (values: Record<string, unknown>, options?: { transaction?: Transaction }) => Promise<unknown> }>(
    model: {
      findOne: (options: FindOptions) => Promise<T | null>;
      create: (values: any, options?: { transaction?: Transaction }) => Promise<T>;
    },
    fieldName: string,
    fieldValue: string,
    values: Record<string, unknown>,
    options: RepositoryOptions,
  ): Promise<{ record: T; created: boolean }> {
    const existing = await model.findOne({ where: { [fieldName]: fieldValue }, transaction: options.transaction } as FindOptions);
    if (existing) {
      await existing.update({ ...values, updatedAtValue: values.updatedAtValue }, { transaction: options.transaction });
      return { record: existing, created: false };
    }
    const record = await model.create(values, { transaction: options.transaction });
    return { record, created: true };
  }

  async listCurrentRiskPolicy() {
    const [modelVersions, rulesetVersions, riskSignalSeeds] = await Promise.all([
      this.riskModelVersionModel.findAll({
        where: { status: { [Op.in]: ['active', 'published'] } },
        order: [
          ['effectiveFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      } as FindOptions),
      this.riskRulesetVersionModel.findAll({
        where: { status: { [Op.in]: ['active', 'published'] } },
        order: [
          ['effectiveFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      } as FindOptions),
      this.riskSignalSeedModel.findAll({
        where: { isActive: true },
        order: [
          ['priority', 'ASC'],
          ['signalCode', 'ASC'],
        ],
      } as FindOptions),
    ]);
    return { modelVersions, rulesetVersions, riskSignalSeeds };
  }

  findRulesByRulesetIds(rulesetVersionIds: string[]): Promise<RiskPolicyRuleModel[]> {
    if (rulesetVersionIds.length === 0) return Promise.resolve([]);
    return this.riskPolicyRuleModel.findAll({
      where: { rulesetVersionId: { [Op.in]: rulesetVersionIds } },
      order: [['ruleCode', 'ASC']],
    } as FindOptions);
  }

  createRiskModelVersion(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskModelVersionModel> {
    return this.riskModelVersionModel.create(values as any, { transaction: options.transaction });
  }
  createRiskRulesetVersion(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskRulesetVersionModel> {
    return this.riskRulesetVersionModel.create(values as any, { transaction: options.transaction });
  }
  createRiskPolicyRule(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskPolicyRuleModel> {
    return this.riskPolicyRuleModel.create(values as any, { transaction: options.transaction });
  }
  createRiskSignalSeed(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskSignalSeedModel> {
    return this.riskSignalSeedModel.create(values as any, { transaction: options.transaction });
  }

  findRiskRulesetVersionById(id: string, options: RepositoryOptions = {}): Promise<RiskRulesetVersionModel | null> {
    return this.riskRulesetVersionModel.findOne({ where: { id }, transaction: options.transaction } as FindOptions);
  }

  async activateRuleset(
    version: RiskRulesetVersionModel,
    values: { approvedByPlatformUserId: string | null; effectiveFrom: Date; now: Date },
    options: RepositoryOptions,
  ): Promise<RiskRulesetVersionModel> {
    version.status = 'active';
    version.effectiveFrom = values.effectiveFrom;
    version.approvedByPlatformUserId = values.approvedByPlatformUserId;
    version.approvedAt = values.now;
    return version.save({ transaction: options.transaction });
  }

  async retireOtherActiveRulesets(
    rulesetCode: string | null,
    currentId: string,
    effectiveUntil: Date,
    options: RepositoryOptions,
  ): Promise<number> {
    if (!rulesetCode) return 0;
    const [count] = await this.riskRulesetVersionModel.update({ status: 'retired', effectiveUntil } as any, {
      where: { rulesetCode, id: { [Op.ne]: currentId }, status: 'active' },
      transaction: options.transaction,
    });
    return count;
  }

  async listDataGovernancePolicies() {
    const [privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules] =
      await Promise.all([
        this.privacyPurposeModel.findAll({ where: { isActive: true }, order: [['purposeCode', 'ASC']] } as FindOptions),
        this.retentionPolicyModel.findAll({ where: { isActive: true }, order: [['policyCode', 'ASC']] } as FindOptions),
        this.dataProviderModel.findAll({ where: { isActive: true }, order: [['providerCode', 'ASC']] } as FindOptions),
        this.classificationPolicyModel.findAll({ order: [['classificationCode', 'ASC']] } as FindOptions),
        this.sensitiveFieldRuleModel.findAll({
          where: { isActive: true },
          order: [
            ['tableName', 'ASC'],
            ['fieldName', 'ASC'],
          ],
        } as FindOptions),
        this.dataQualityRuleModel.findAll({ where: { isActive: true }, order: [['ruleCode', 'ASC']] } as FindOptions),
      ]);
    return { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules };
  }

  upsertPrivacyPurpose(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.privacyPurposeModel, 'purposeCode', values.purposeCode as string, values, options);
  }
  upsertRetentionPolicy(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.retentionPolicyModel, 'policyCode', values.policyCode as string, values, options);
  }
  upsertDataProvider(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.dataProviderModel, 'providerCode', values.providerCode as string, values, options);
  }
  upsertClassificationPolicy(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.classificationPolicyModel, 'classificationCode', values.classificationCode as string, values, options);
  }
  upsertDataQualityRule(values: Record<string, unknown>, options: RepositoryOptions) {
    return this.upsertByCode(this.dataQualityRuleModel, 'ruleCode', values.ruleCode as string, values, options);
  }

  async upsertSensitiveFieldRule(values: Record<string, unknown>, options: RepositoryOptions) {
    const existing = await this.sensitiveFieldRuleModel.findOne({
      where: { tableName: values.tableName, fieldName: values.fieldName },
      transaction: options.transaction,
    } as FindOptions);
    if (existing) {
      await existing.update({ ...values, updatedAtValue: values.updatedAtValue }, { transaction: options.transaction });
      return { record: existing, created: false };
    }
    const record = await this.sensitiveFieldRuleModel.create(values as any, { transaction: options.transaction });
    return { record, created: true };
  }

  createAudit(values: AuditValues, options: RepositoryOptions): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: values.actorPlatformUserId,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        payloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      } as any,
      { transaction: options.transaction },
    );
  }

  createDataChange(values: DataChangeValues, options: RepositoryOptions): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: values.actorPlatformUserId,
        oldValuesHash: null,
        newValuesHash: hashPayload(values.newValues),
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      } as any,
      { transaction: options.transaction },
    );
  }
}
