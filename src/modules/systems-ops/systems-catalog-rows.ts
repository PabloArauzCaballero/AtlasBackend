/**
 * @file Constructores de las filas del catálogo operativo a partir de sus semillas.
 * @business Cada endpoint, herramienta y entidad de datos debe quedar documentado con valores por defecto honestos para auditoría.
 * @system funciones puras seed -> fila: aplican los textos y banderas por defecto antes del upsert en el repositorio.
 */
import type { DataEntitySeed, EndpointSeed, ToolSeed } from './systems-ops.types.js';

export function buildEndpointRow(seed: EndpointSeed, now: Date) {
  return {
    code: seed.code,
    systemCode: 'ATLAS_BACKEND',
    module: seed.module,
    controllerName: seed.controllerName ?? null,
    handlerName: seed.handlerName ?? null,
    method: seed.method,
    routePath: seed.fullPath.replace(/^\/api\/v[0-9]+\//, '/'),
    fullPath: seed.fullPath,
    routeName: seed.routeName,
    businessPurpose: seed.businessPurpose,
    businessAction: seed.businessAction ?? null,
    expectedResponseSummary: seed.expectedResponseSummary ?? null,
    technicalPurpose:
      seed.technicalPurpose ??
      `Ejecuta ${seed.method} ${seed.fullPath} dentro del módulo ${seed.module}. Debe mantener contrato de entrada, salida, permisos y trazabilidad coherentes con el catálogo de sistemas.`,
    businessValue: seed.businessValue ?? seed.businessPurpose,
    auditStrategy:
      seed.auditStrategy ??
      `Auditar requestId, actor, roles, parámetros no sensibles, entidades afectadas, resultado HTTP y errores para reconstruir el uso de ${seed.fullPath}.`,
    decisionUseCases: seed.decisionUseCases ?? [
      'operación del portal interno',
      'soporte y diagnóstico',
      'auditoría de acciones',
      'control de riesgo operativo',
    ],
    inputPayloadContract: seed.inputPayloadContract ?? {
      body: seed.minPayloadSchema ?? {},
      query: seed.queryParamsSchema ?? {},
      path: seed.pathParamsSchema ?? {},
      headers: seed.headersSchema ?? {},
    },
    outputContract: seed.outputContract ?? {
      expectedStatusCodes: seed.expectedStatusCodes ?? [200],
      summary: seed.expectedResponseSummary ?? 'Respuesta documentada por catálogo y smoke tests.',
    },
    payloadOriginSummary:
      seed.payloadOriginSummary ??
      'Los valores de entrada provienen de body, query, path o headers validados por DTO/Zod cuando aplica; los metadatos técnicos los completa el backend.',
    sideEffectsSummary:
      seed.sideEffectsSummary ??
      (seed.method === 'GET'
        ? 'Lectura sin escritura de negocio esperada.'
        : 'Puede escribir estado operacional, auditoría, eventos internos o tablas de dominio según el caso de uso.'),
    metadataCompletenessScore: seed.metadataCompletenessScore ?? 75,
    expectedStatusCodes: seed.expectedStatusCodes ?? [200],
    minPayloadSchema: seed.minPayloadSchema ?? {},
    queryParamsSchema: seed.queryParamsSchema ?? {},
    pathParamsSchema: seed.pathParamsSchema ?? {},
    headersSchema: seed.headersSchema ?? {},
    requiresAuth: seed.requiresAuth ?? true,
    allowedRoles: seed.allowedRoles ?? [],
    containsPii: seed.containsPii ?? false,
    piiFields: seed.piiFields ?? [],
    riskLevel: seed.riskLevel ?? 'LOW',
    isDestructive: seed.isDestructive ?? false,
    isReadonly: seed.isReadonly ?? seed.method === 'GET',
    idempotencyRequired: seed.idempotencyRequired ?? false,
    requiresStressTest: seed.requiresStressTest ?? false,
    requiresIntegrationTest: seed.requiresIntegrationTest ?? false,
    isTestableFromPortal: seed.isTestableFromPortal ?? false,
    testEnvironmentOnly: seed.testEnvironmentOnly ?? true,
    ownerTeam: seed.ownerTeam ?? 'systems',
    status: seed.status ?? 'ACTIVE',
    version: 'v1',
    detectedFrom: seed.detectedFrom ?? 'manual_seed',
    confidenceLevel: seed.confidenceLevel ?? 'MEDIUM',
    reviewStatus: seed.reviewStatus ?? 'NEEDS_REVIEW',
    sourceFile: seed.sourceFile ?? null,
    createdAtValue: now,
    updatedAtValue: now,
  };
}

export function buildToolRow(seed: ToolSeed, now: Date) {
  return {
    code: seed.code,
    name: seed.name,
    type: seed.type,
    provider: seed.provider ?? null,
    purpose: seed.purpose,
    description:
      seed.description ??
      `${seed.name} se registra como herramienta de soporte del backend Atlas. Debe contar con owner, variables requeridas, estado operativo y evidencia de prueba cuando sea crítica.`,
    businessValue: seed.businessValue ?? seed.purpose,
    technicalUsage: seed.technicalUsage ?? `Usada por servicios o procesos del backend para ${seed.purpose.toLowerCase()}.`,
    auditNotes:
      seed.auditNotes ??
      'Debe quedar registrada cuando participe en decisiones críticas, integraciones externas, autenticación, almacenamiento, colas, pruebas o auditoría.',
    failureRisks:
      seed.failureRisks ??
      (seed.isCritical
        ? 'Falla crítica: puede degradar operación, seguridad, trazabilidad o disponibilidad del portal.'
        : 'Falla controlada: debe monitorearse y documentarse según su estado operativo.'),
    requiredEnvVars: seed.requiredEnvVars ?? [],
    hasSandbox: seed.hasSandbox ?? false,
    healthcheckRoute: seed.healthcheckRoute ?? null,
    requiresCredentials: seed.requiresCredentials ?? false,
    isCritical: seed.isCritical ?? false,
    status: seed.status ?? 'ACTIVE',
    ownerTeam: seed.ownerTeam ?? 'systems',
    createdAtValue: now,
    updatedAtValue: now,
  };
}

export function buildDataEntityRow(seed: DataEntitySeed, now: Date) {
  return {
    /*
     * El `system_code` viaja EXPLICITO aunque tenga valor por defecto: forma parte de la clave
     * unica, y una clave de conflicto que depende de un default se rompe en silencio el dia que
     * alguien cambia ese default.
     */
    systemCode: 'ATLAS_BACKEND',
    schemaName: seed.schemaName,
    tableName: seed.tableName,
    modelName: seed.modelName ?? null,
    entityName: seed.entityName,
    module: seed.module,
    businessPurpose: seed.businessPurpose,
    description: seed.description ?? seed.businessPurpose,
    technicalPurpose:
      seed.technicalPurpose ??
      `Tabla ${seed.schemaName}.${seed.tableName} registrada en el catálogo operativo para que endpoints, campos, relaciones y reglas puedan auditarse.`,
    businessProcess: seed.businessProcess ?? `Proceso operativo del módulo ${seed.module}.`,
    whyStore: seed.whyStore ?? 'Se guarda para sostener trazabilidad, continuidad operativa, auditoría y análisis posterior del negocio.',
    whoUses: seed.whoUses ?? ['sistemas', 'operaciones', 'riesgo', 'auditoría'],
    auditUsage: seed.auditUsage ?? 'Permite reconstruir quién consultó o modificó el dato, cuándo ocurrió y qué endpoint participó.',
    analysisUsage: seed.analysisUsage ?? 'Permite segmentar, medir calidad, construir reportes y detectar patrones operativos o de riesgo.',
    decisionUsage:
      seed.decisionUsage ?? 'Sirve para decisiones operativas del portal, priorización, control interno o investigación según el dominio.',
    dataNature: seed.dataNature ?? 'OPERACIONAL',
    domainCode: seed.domainCode ?? null,
    dataGrain: seed.dataGrain ?? `Una fila representa un registro operacional de ${seed.tableName}.`,
    sourceSystem: seed.sourceSystem ?? 'atlas-backend',
    operationalRulesJson: seed.operationalRulesJson ?? [],
    qualityRulesJson: seed.qualityRulesJson ?? [],
    keyRelationshipsSummary: seed.keyRelationshipsSummary ?? null,
    relationshipRationale: seed.relationshipRationale ?? null,
    internationalizationNotes:
      seed.internationalizationNotes ??
      'Usar tenant, país, moneda, zona horaria, idioma y políticas locales cuando el modelo escale a otros mercados.',
    dataOwner: seed.dataOwner ?? 'systems',
    containsPii: seed.containsPii,
    containsFinancialData: seed.containsFinancialData,
    containsRiskData: seed.containsRiskData,
    containsLegalData: seed.containsLegalData,
    containsDeviceData: seed.containsDeviceData,
    containsLocationData: seed.containsLocationData,
    isAuditCritical: seed.isAuditCritical,
    retentionPolicyCode: seed.retentionPolicyCode ?? null,
    status: seed.status ?? 'ACTIVE',
    detectedFrom: seed.detectedFrom,
    confidenceLevel: seed.confidenceLevel,
    reviewStatus: seed.reviewStatus,
    createdAtValue: now,
    updatedAtValue: now,
  };
}
