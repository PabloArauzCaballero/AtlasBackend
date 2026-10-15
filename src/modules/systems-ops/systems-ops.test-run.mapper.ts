/**
 * @file Mapper: transforma suites, pasos, ejecuciones, bitácora y perfiles de estrés a contratos de transporte.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import {
  SystemActionLogModel,
  SystemStressProfileModel,
  SystemTestRunModel,
  SystemTestStepModel,
  SystemTestStepRunModel,
  SystemTestSuiteModel,
} from '../../database/models/index.js';
import { redactSecretHeaders } from './systems-header-redaction.util.js';

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
    // Lo lee todo SYSTEMS_OPS_ROLES (auditores, analistas): las llaves no salen en claro.
    defaultHeaders: redactSecretHeaders(row.defaultHeaders, { keepTemplates: true }),
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
