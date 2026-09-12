/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { SystemEndpointToolRequirementModel, SystemToolCatalogModel } from '../../database/models/index.js';

export function mapTool(row: SystemToolCatalogModel) {
  return {
    toolId: String(row.id),
    code: row.code,
    name: row.name,
    type: row.type,
    provider: row.provider,
    purpose: row.purpose,
    description: row.description,
    businessValue: row.businessValue,
    technicalUsage: row.technicalUsage,
    auditNotes: row.auditNotes,
    failureRisks: row.failureRisks,
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
