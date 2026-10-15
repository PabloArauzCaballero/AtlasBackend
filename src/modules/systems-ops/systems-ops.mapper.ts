/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import {
  SystemDataEntityCatalogModel,
  SystemDataFieldCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
} from '../../database/models/index.js';

// `mapTool` y `mapToolRequirement` viven en su propio archivo: este mapper ya estaba en la deuda
// congelada de tamaño (383 líneas) y añadirles la metadata de gobierno lo empujaba por encima. Se
// reexportan para que los cuatro consumidores no tengan que enterarse de dónde vive cada función.
export { mapTool, mapToolRequirement } from './systems-ops.tool.mapper.js';

export function mapEndpoint(row: SystemEndpointCatalogModel) {
  return {
    endpointId: String(row.id),
    code: row.code,
    module: row.module,
    systemCode: row.systemCode ?? 'ATLAS_BACKEND',
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

export function mapDataEntity(row: SystemDataEntityCatalogModel) {
  return {
    entityId: String(row.id),
    systemCode: row.systemCode ?? 'ATLAS_BACKEND',
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
