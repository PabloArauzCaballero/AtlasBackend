import {
  AttributeDefinitionModel,
  ContextCatalogModel,
  ContextCatalogVersionModel,
  ContextItemAliasModel,
  ContextItemModel,
  ContextRiskMappingModel,
  ContextStagingItemModel,
  DataClassificationPolicyModel,
  DataProviderModel,
  DataQualityRuleModel,
  EventDefinitionModel,
  FeatureDefinitionModel,
  ObservationDefinitionModel,
  PrivacyProcessingPurposeModel,
  RetentionPolicyModel,
  RiskModelVersionModel,
  RiskPolicyRuleModel,
  RiskRulesetVersionModel,
  RiskSignalSeedModel,
  SensitiveFieldRuleModel,
} from '../../database/models/index.js';

export function catalogDto(catalog: ContextCatalogModel, currentVersion?: ContextCatalogVersionModel | null) {
  return {
    catalogId: String(catalog.id),
    catalogCode: catalog.catalogCode,
    catalogName: catalog.catalogName,
    domain: catalog.domain,
    description: catalog.description,
    ownerTeam: catalog.ownerTeam,
    isActive: catalog.isActive,
    currentVersion: currentVersion
      ? {
          catalogVersionId: String(currentVersion.id),
          versionCode: currentVersion.versionCode,
          status: currentVersion.status,
          validFrom: currentVersion.validFrom,
          validUntil: currentVersion.validUntil,
        }
      : null,
  };
}

export function catalogVersionDto(version: ContextCatalogVersionModel) {
  return {
    catalogVersionId: String(version.id),
    versionCode: version.versionCode,
    status: version.status,
    validFrom: version.validFrom,
    validUntil: version.validUntil,
    approvedAt: version.approvedAt,
    notes: version.notes,
  };
}

export function contextItemDto(item: ContextItemModel, aliases: ContextItemAliasModel[], mappings: ContextRiskMappingModel[]) {
  return {
    contextItemId: String(item.id),
    itemCode: item.itemCode,
    itemName: item.itemName,
    itemType: item.itemType,
    attributes: item.attributesJson ?? {},
    sourceId: item.sourceId ? String(item.sourceId) : null,
    confidenceScore: item.confidenceScore,
    isActive: item.isActive,
    aliases: aliases.map((alias) => ({
      aliasId: String(alias.id),
      aliasValue: alias.aliasValue,
      aliasType: alias.aliasType,
      normalizedAlias: alias.normalizedAlias,
      confidenceScore: alias.confidenceScore,
    })),
    riskMappings: mappings.map((mapping) => ({
      riskMappingId: String(mapping.id),
      riskDimension: mapping.riskDimension,
      riskBand: mapping.riskBand,
      scorePointsSuggested: mapping.scorePointsSuggested,
      reasonCode: mapping.reasonCode,
      explanation: mapping.explanation,
      modelUsage: mapping.modelUsage,
      validFrom: mapping.validFrom,
      validUntil: mapping.validUntil,
    })),
  };
}

export function stagingItemDto(item: ContextStagingItemModel) {
  return {
    stagingItemId: String(item.id),
    catalogId: item.catalogId ? String(item.catalogId) : null,
    ingestionJobId: item.ingestionJobId ? String(item.ingestionJobId) : null,
    proposedItemCode: item.proposedItemCode,
    proposedItemName: item.proposedItemName,
    proposedAttributes: item.proposedAttributesJson ?? {},
    aiSuggested: item.aiSuggested,
    reviewStatus: item.reviewStatus,
    reviewNotes: item.reviewNotes,
  };
}

export function definitionDtos(values: {
  observations: ObservationDefinitionModel[];
  events: EventDefinitionModel[];
  attributes: AttributeDefinitionModel[];
  features: FeatureDefinitionModel[];
}) {
  return {
    observations: values.observations.map((item) => ({
      observationDefinitionId: String(item.id),
      observationCode: item.observationCode,
      observationName: item.observationName,
      dataType: item.dataType,
      sourceGroup: item.sourceGroup,
      riskDimension: item.riskDimension,
      isActive: item.isActive,
    })),
    events: values.events.map((item) => ({
      eventDefinitionId: String(item.id),
      eventCode: item.eventCode,
      eventName: item.eventName,
      eventFamily: item.eventFamily,
      sourcePackage: item.sourcePackage,
      riskDimension: item.riskDimension,
      isHighVolume: item.isHighVolume,
      isActive: item.isActive,
    })),
    attributes: values.attributes.map((item) => ({
      attributeDefinitionId: String(item.id),
      attributeCode: item.attributeCode,
      attributeName: item.attributeName,
      entityScope: item.entityScope,
      dataType: item.dataType,
      riskDimension: item.riskDimension,
      isSensitive: item.isSensitive,
      isActive: item.isActive,
    })),
    features: values.features.map((item) => ({
      featureDefinitionId: String(item.id),
      featureCode: item.featureCode,
      featureName: item.featureName,
      featureFamily: item.featureFamily,
      riskDimension: item.riskDimension,
      dataType: item.dataType,
      isModelInput: item.isModelInput,
      isPolicyRuleInput: item.isPolicyRuleInput,
      isActive: item.isActive,
    })),
  };
}

export function riskPolicyDto(values: {
  modelVersions: RiskModelVersionModel[];
  rulesetVersions: RiskRulesetVersionModel[];
  rules: RiskPolicyRuleModel[];
  riskSignalSeeds: RiskSignalSeedModel[];
}) {
  return {
    modelVersions: values.modelVersions.map((model) => ({
      riskModelVersionId: String(model.id),
      modelCode: model.modelCode,
      versionCode: model.versionCode,
      modelType: model.modelType,
      assessmentType: model.assessmentType,
      status: model.status,
      effectiveFrom: model.effectiveFrom,
      effectiveUntil: model.effectiveUntil,
    })),
    rulesetVersions: values.rulesetVersions.map((ruleset) => ({
      riskRulesetVersionId: String(ruleset.id),
      rulesetCode: ruleset.rulesetCode,
      versionCode: ruleset.versionCode,
      assessmentType: ruleset.assessmentType,
      status: ruleset.status,
      effectiveFrom: ruleset.effectiveFrom,
      effectiveUntil: ruleset.effectiveUntil,
      rules: values.rules
        .filter((rule) => String(rule.rulesetVersionId) === String(ruleset.id))
        .map((rule) => ({
          riskPolicyRuleId: String(rule.id),
          ruleCode: rule.ruleCode,
          ruleName: rule.ruleName,
          riskDimension: rule.riskDimension,
          ruleType: rule.ruleType,
          severity: rule.severity,
          actionCode: rule.actionCode,
          reasonCode: rule.reasonCode,
          isHardStop: rule.isHardStop,
        })),
    })),
    riskSignalSeeds: values.riskSignalSeeds.map((seed) => ({
      riskSignalSeedId: String(seed.id),
      signalCode: seed.signalCode,
      signalName: seed.signalName,
      signalType: seed.signalType,
      sourceEntity: seed.sourceEntity,
      riskDimension: seed.riskDimension,
      priority: seed.priority,
      expectedDirection: seed.expectedDirection,
      isActive: seed.isActive,
    })),
  };
}

export function dataGovernanceDto(values: {
  privacyPurposes: PrivacyProcessingPurposeModel[];
  retentionPolicies: RetentionPolicyModel[];
  dataProviders: DataProviderModel[];
  classificationPolicies: DataClassificationPolicyModel[];
  sensitiveFieldRules: SensitiveFieldRuleModel[];
  dataQualityRules: DataQualityRuleModel[];
}) {
  return {
    privacyPurposes: values.privacyPurposes.map((item) => ({
      purposeId: String(item.id),
      purposeCode: item.purposeCode,
      purposeName: item.purposeName,
      legalBasis: item.legalBasis,
      requiresExplicitConsent: item.requiresExplicitConsent,
    })),
    retentionPolicies: values.retentionPolicies.map((item) => ({
      retentionPolicyId: String(item.id),
      policyCode: item.policyCode,
      appliesTo: item.appliesTo,
      retentionDays: item.retentionDays,
      postRetentionAction: item.postRetentionAction,
      legalBasis: item.legalBasis,
    })),
    dataProviders: values.dataProviders.map((item) => ({
      dataProviderId: String(item.id),
      providerCode: item.providerCode,
      providerName: item.providerName,
      providerType: item.providerType,
      reliabilityScore: item.reliabilityScore,
      supportsRetroData: item.supportsRetroData,
    })),
    classificationPolicies: values.classificationPolicies.map((item) => ({
      classificationPolicyId: String(item.id),
      classificationCode: item.classificationCode,
      classificationName: item.classificationName,
      sensitivityLevel: item.sensitivityLevel,
      defaultStorageMode: item.defaultStorageMode,
      encryptionRequired: item.encryptionRequired,
      hashingRequired: item.hashingRequired,
      rawStorageAllowed: item.rawStorageAllowed,
    })),
    sensitiveFieldRules: values.sensitiveFieldRules.map((item) => ({
      sensitiveFieldRuleId: String(item.id),
      tableName: item.tableName,
      fieldName: item.fieldName,
      classificationCode: item.classificationCode,
      storageMode: item.storageMode,
      searchStrategy: item.searchStrategy,
      maskingStrategy: item.maskingStrategy,
      accessPolicyCode: item.accessPolicyCode,
    })),
    dataQualityRules: values.dataQualityRules.map((item) => ({
      dataQualityRuleId: String(item.id),
      ruleCode: item.ruleCode,
      ruleName: item.ruleName,
      targetTable: item.targetTable,
      targetField: item.targetField,
      severity: item.severity,
      expectedAction: item.expectedAction,
      isActive: item.isActive,
    })),
  };
}
