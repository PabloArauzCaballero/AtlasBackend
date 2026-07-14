import {
  SystemActionLogModel,
  SystemStressProfileModel,
  SystemDataEntityCatalogModel,
  SystemDataFieldCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemTestRunModel,
  SystemTestStepModel,
  SystemTestStepRunModel,
  SystemTestSuiteModel,
  SystemToolCatalogModel,
} from '../../database/models/index.js';

export function mapEndpoint(row: SystemEndpointCatalogModel) {
  return {
    endpointId: String(row.id),
    code: row.code,
    module: row.module,
    backendService: row.backendService ?? 'atlas-backend',
    backendBaseUrl: row.backendBaseUrl ?? null,
    controllerName: row.controllerName,
    handlerName: row.handlerName,
    method: row.method,
    routePath: row.routePath,
    fullPath: row.fullPath,
    routeName: row.routeName,
    businessPurpose: row.businessPurpose,
    businessAction: row.businessAction,
    expectedResponseSummary: row.expectedResponseSummary,
    expectedStatusCodes: row.expectedStatusCodes,
    minPayloadSchema: row.minPayloadSchema,
    queryParamsSchema: row.queryParamsSchema,
    pathParamsSchema: row.pathParamsSchema,
    headersSchema: row.headersSchema,
    requiresAuth: row.requiresAuth,
    allowedRoles: row.allowedRoles,
    containsPii: row.containsPii,
    piiFields: row.piiFields,
    riskLevel: row.riskLevel,
    isDestructive: row.isDestructive,
    isReadonly: row.isReadonly,
    idempotencyRequired: row.idempotencyRequired,
    requiresStressTest: row.requiresStressTest,
    requiresIntegrationTest: row.requiresIntegrationTest,
    isTestableFromPortal: row.isTestableFromPortal,
    testEnvironmentOnly: row.testEnvironmentOnly,
    ownerTeam: row.ownerTeam,
    status: row.status,
    version: row.version,
    detectedFrom: row.detectedFrom,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
    sourceFile: row.sourceFile,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
    updatedAt: row.updatedAtValue?.toISOString?.() ?? null,
  };
}

export function mapTool(row: SystemToolCatalogModel) {
  return {
    toolId: String(row.id),
    code: row.code,
    name: row.name,
    type: row.type,
    provider: row.provider,
    purpose: row.purpose,
    requiredEnvVars: row.requiredEnvVars,
    hasSandbox: row.hasSandbox,
    healthcheckRoute: row.healthcheckRoute,
    requiresCredentials: row.requiresCredentials,
    isCritical: row.isCritical,
    isWorker: row.isWorker,
    status: row.status,
    ownerTeam: row.ownerTeam,
  };
}

export function mapDataEntity(row: SystemDataEntityCatalogModel) {
  return {
    entityId: String(row.id),
    schemaName: row.schemaName,
    tableName: row.tableName,
    modelName: row.modelName,
    entityName: row.entityName,
    module: row.module,
    businessPurpose: row.businessPurpose,
    dataOwner: row.dataOwner,
    containsPii: row.containsPii,
    containsFinancialData: row.containsFinancialData,
    containsRiskData: row.containsRiskData,
    containsLegalData: row.containsLegalData,
    containsDeviceData: row.containsDeviceData,
    containsLocationData: row.containsLocationData,
    isAuditCritical: row.isAuditCritical,
    retentionPolicyCode: row.retentionPolicyCode,
    status: row.status,
    detectedFrom: row.detectedFrom,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
  };
}

export function mapDomain(row: SystemDomainCatalogModel) {
  return {
    domainId: String(row.id),
    domainCode: row.domainCode,
    domainName: row.domainName,
    description: row.description,
    businessDefinition: row.businessDefinition,
    technicalScope: row.technicalScope,
    dataNature: row.dataNature,
    ownerTeam: row.ownerTeam,
    countriesApplicable: row.countriesApplicable,
    regulatoryNotes: row.regulatoryNotes,
    exampleTables: row.exampleTables,
    decisionUseCases: row.decisionUseCases,
    auditRelevance: row.auditRelevance,
    status: row.status,
  };
}

export function mapDataField(row: SystemDataFieldCatalogModel) {
  return {
    columnId: String(row.id),
    dataEntityId: row.dataEntityId ? String(row.dataEntityId) : null,
    schemaName: row.schemaName,
    tableName: row.tableName,
    columnName: row.columnName,
    ordinalPosition: row.ordinalPosition,
    businessName: row.businessName,
    dataType: row.sqlDataType,
    sqlDataType: row.sqlDataType,
    isNullable: row.isNullable,
    isPrimaryKey: row.isPrimaryKey,
    isForeignKey: row.isForeignKey,
    referencesEntityId: row.referencesEntityId ? String(row.referencesEntityId) : null,
    referencesSchema: row.referencedSchema,
    referencesTable: row.referencedTable,
    referencesColumnName: row.referencedColumn,
    defaultValue: row.columnDefault,
    businessDescription: row.businessMeaning,
    technicalDescription: row.technicalMeaning,
    businessMeaning: row.businessMeaning,
    technicalMeaning: row.technicalMeaning,
    systemPurpose: row.systemPurpose ?? row.technicalMeaning,
    businessPurpose: row.businessPurpose ?? row.businessMeaning,
    containsPii: row.containsPii,
    piiType: row.piiType,
    containsSensitive: row.containsSensitive || row.containsPii || row.containsFinancialData || row.containsRiskData,
    containsFinancial: row.containsFinancialData,
    containsFinancialData: row.containsFinancialData,
    containsRiskData: row.containsRiskData,
    usedInScoring: row.usedInScoring || row.containsRiskData,
    usedInMl: row.usedInMl || row.isMlCandidate,
    isMlCandidate: row.isMlCandidate,
    validationRule: row.validationRuleJson,
    allowedValues: row.allowedValues,
    status: row.status,
    detectedFrom: row.detectedFrom ?? row.sourceDocument,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
    updatedAt: row.updatedAtValue?.toISOString?.() ?? null,
  };
}

export function mapDataRelationship(row: SystemDataRelationshipCatalogModel) {
  return {
    relationId: String(row.id),
    relationshipId: String(row.id),
    sourceDataEntityId: row.sourceDataEntityId ? String(row.sourceDataEntityId) : null,
    targetDataEntityId: row.targetDataEntityId ? String(row.targetDataEntityId) : null,
    sourceSchema: row.sourceSchema,
    sourceTable: row.sourceTable,
    sourceColumn: row.sourceColumn,
    targetSchema: row.targetSchema,
    targetTable: row.targetTable,
    targetColumn: row.targetColumn,
    column: row.sourceColumn,
    referencesEntityId: row.targetDataEntityId ? String(row.targetDataEntityId) : null,
    referencesColumn: row.targetColumn,
    relationshipType: row.relationshipType,
    cardinality: row.cardinality,
    optionality: row.optionality,
    businessReason: row.businessReason,
    technicalReason: row.technicalReason,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
  };
}

export function mapToolRequirement(row: SystemEndpointToolRequirementModel, tool?: SystemToolCatalogModel) {
  return {
    requirementId: String(row.id),
    endpointId: String(row.endpointId),
    toolId: String(row.toolId),
    tool: tool ? { code: tool.code, name: tool.name, type: tool.type } : undefined,
    usageType: row.usageType,
    isRequired: row.isRequired,
    failureImpact: row.failureImpact,
    fallbackStrategy: row.fallbackStrategy,
    requiresMock: row.requiresMock,
    requiresStressTest: row.requiresStressTest,
    notes: row.notes,
    detectedFrom: row.detectedFrom,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
  };
}

export function mapDataImpact(row: SystemEndpointDataEntityImpactModel, dataEntity?: SystemDataEntityCatalogModel) {
  return {
    impactId: String(row.id),
    endpointId: String(row.endpointId),
    dataEntityId: String(row.dataEntityId),
    dataEntity: dataEntity
      ? { schemaName: dataEntity.schemaName, tableName: dataEntity.tableName, entityName: dataEntity.entityName }
      : undefined,
    operationType: row.operationType,
    impactLevel: row.impactLevel,
    isPrimaryEntity: row.isPrimaryEntity,
    isTransactional: row.isTransactional,
    rollbackRequired: row.rollbackRequired,
    affectsCustomerState: row.affectsCustomerState,
    affectsFinancialState: row.affectsFinancialState,
    affectsRiskState: row.affectsRiskState,
    affectsLegalState: row.affectsLegalState,
    affectsDeviceState: row.affectsDeviceState,
    affectsNotificationState: row.affectsNotificationState,
    requiresAuditLog: row.requiresAuditLog,
    requiresRegressionTest: row.requiresRegressionTest,
    requiresStressTest: row.requiresStressTest,
    notes: row.notes,
    detectedFrom: row.detectedFrom,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
  };
}

export function mapFieldImpact(row: SystemEndpointFieldImpactModel, dataEntity?: SystemDataEntityCatalogModel) {
  return {
    fieldImpactId: String(row.id),
    endpointId: String(row.endpointId),
    dataEntityId: String(row.dataEntityId),
    dataEntity: dataEntity
      ? { schemaName: dataEntity.schemaName, tableName: dataEntity.tableName, entityName: dataEntity.entityName }
      : undefined,
    fieldName: row.fieldName,
    fieldOperation: row.fieldOperation,
    isRequiredInput: row.isRequiredInput,
    isGenerated: row.isGenerated,
    isSensitive: row.isSensitive,
    isMlCandidate: row.isMlCandidate,
    mlFeatureGroup: row.mlFeatureGroup,
    validationRule: row.validationRule,
    notes: row.notes,
    confidenceLevel: row.confidenceLevel,
    reviewStatus: row.reviewStatus,
  };
}

export function mapTestSuite(row: SystemTestSuiteModel) {
  return {
    suiteId: String(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    module: row.module,
    suiteType: row.suiteType,
    executionMode: row.executionMode,
    environmentScope: row.environmentScope,
    isEnabled: row.isEnabled,
    requiresSeedData: row.requiresSeedData,
    isSafeForProduction: row.isSafeForProduction,
    requiresDestructivePermission: row.requiresDestructivePermission,
  };
}

export function mapTestStep(row: SystemTestStepModel) {
  return {
    stepId: String(row.id),
    suiteId: String(row.suiteId),
    endpointId: row.endpointId ? String(row.endpointId) : null,
    stepOrder: row.stepOrder,
    name: row.name,
    inputMode: row.inputMode,
    method: row.method,
    pathTemplate: row.pathTemplate,
    defaultHeaders: row.defaultHeaders,
    defaultPayload: row.defaultPayload,
    configSchema: row.configSchema,
    extractors: row.extractors,
    assertions: row.assertions,
    continueOnFailure: row.continueOnFailure,
    cleanupRequired: row.cleanupRequired,
  };
}

export function mapTestRun(row: SystemTestRunModel) {
  return {
    runId: String(row.id),
    suiteId: String(row.suiteId),
    environment: row.environment,
    triggeredBy: row.triggeredBy,
    status: row.status,
    startedAt: row.startedAt?.toISOString?.() ?? null,
    finishedAt: row.finishedAt?.toISOString?.() ?? null,
    durationMs: row.durationMs,
    summary: row.summary,
    logsUrl: row.logsUrl,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
  };
}

export function mapTestStepRun(row: SystemTestStepRunModel) {
  return {
    stepRunId: String(row.id),
    testRunId: String(row.testRunId),
    stepId: String(row.stepId),
    status: row.status,
    requestPayloadSanitized: row.requestPayloadSanitized,
    responseBodySanitized: row.responseBodySanitized,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
  };
}

export function mapActionLog(row: SystemActionLogModel) {
  return {
    actionLogId: String(row.id),
    requestId: row.requestId,
    correlationId: row.correlationId,
    endpointCatalogId: row.endpointCatalogId ? String(row.endpointCatalogId) : null,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    actorRole: row.actorRole,
    method: row.method,
    routeTemplate: row.routeTemplate,
    resolvedUrlSanitized: row.resolvedUrlSanitized,
    module: row.module,
    actionName: row.actionName,
    ipAddress: row.ipAddress,
    targetType: row.targetType,
    targetId: row.targetId,
    customerId: row.customerId ? String(row.customerId) : null,
    responseStatusCode: row.responseStatusCode,
    durationMs: row.durationMs,
    riskLevel: row.riskLevel,
    containsPii: row.containsPii,
    occurredAt: row.occurredAt?.toISOString?.() ?? null,
  };
}

export function mapStressProfile(row: SystemStressProfileModel) {
  return {
    profileId: String(row.id),
    endpointId: String(row.endpointId),
    code: row.code,
    name: row.name,
    targetRps: row.targetRps,
    durationSeconds: row.durationSeconds,
    concurrency: row.concurrency,
    environmentScope: row.environmentScope,
    maxErrorRate: row.maxErrorRate,
    maxP95Ms: row.maxP95Ms,
    isEnabled: row.isEnabled,
    requiresApproval: row.requiresApproval,
    status: row.status,
    notes: row.notes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
    updatedAt: row.updatedAtValue?.toISOString?.() ?? null,
  };
}
