/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza fija que una definición nueva nunca nazca habilitada para decidir crédito o fraude.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { DefinitionsPackageDto } from '../catalog-management.schemas.js';

type Definitions = DefinitionsPackageDto['definitions'];
type Timestamps = { createdAtValue: Date; updatedAtValue: Date };

/**
 * Traducción DTO → fila para las cuatro familias de definiciones del catálogo.
 *
 * Extraído de `CatalogDefinitionsService.upsertDefinitionsPackage`, que era una única función de 147
 * líneas y **complejidad ciclomática 57** — la peor del repositorio. La forma del código era simple
 * (cuatro bucles), pero cada `??` de esos objetos es una rama, y ahí viven los defaults que
 * verdaderamente importan:
 *
 * > `allowedForCreditDecision: false`, `allowedForFraudDecision: false`,
 * > `legalReviewStatus: 'pending'`, `prohibitedReasonCode: null`
 *
 * Es decir: **una definición nueva no puede usarse para decidir un crédito ni para marcar fraude
 * hasta que alguien lo pida explícitamente y pase revisión legal**. Esa regla estaba enterrada a 100
 * líneas de profundidad dentro del callback de una transacción, donde ni se lee ni se prueba por
 * separado. Aquí es una función pura, nombrada y verificable sin montar una transacción.
 *
 * No cambia ningún comportamiento: son los mismos campos y los mismos defaults, movidos.
 */
export function toEventDefinitionRow(item: Definitions['events'][number], domain: string, at: Timestamps) {
  return {
    eventCode: item.eventCode,
    eventName: item.eventName,
    eventFamily: item.eventFamily ?? domain,
    sourcePackage: item.sourcePackage ?? domain,
    targetTablesJson: { tables: item.targetTables },
    expectedPayloadSchemaJson: item.expectedPayloadSchema,
    riskDimension: item.riskDimension ?? null,
    buildPhase: item.buildPhase ?? null,
    dataClassificationCode: item.dataClassificationCode ?? null,
    retentionPolicyId: item.retentionPolicyId ?? null,
    isHighVolume: item.isHighVolume ?? false,
    isActive: true,
    ...at,
  };
}

export function toObservationDefinitionRow(item: Definitions['observations'][number], domain: string, at: Timestamps) {
  return {
    observationCode: item.observationCode,
    observationName: item.observationName,
    dataType: item.dataType ?? 'string',
    sourceGroup: item.sourceGroup ?? domain,
    expectedAvailabilityStage: item.expectedAvailabilityStage ?? null,
    buildPhase: item.buildPhase ?? null,
    dataClassificationCode: item.dataClassificationCode ?? null,
    riskDimension: item.riskDimension ?? null,
    requiresConsent: item.requiresConsent ?? false,
    // Defaults de seguridad: sin decisión de crédito/fraude y sin aprobación legal por omisión.
    allowedForCreditDecision: item.allowedForCreditDecision ?? false,
    allowedForFraudDecision: item.allowedForFraudDecision ?? false,
    legalReviewStatus: item.legalReviewStatus ?? 'pending',
    prohibitedReasonCode: null,
    fairnessReviewRequired: item.fairnessReviewRequired ?? false,
    retentionPolicyId: item.retentionPolicyId ?? null,
    isActive: true,
    ...at,
  };
}

export function toAttributeDefinitionRow(item: Definitions['attributes'][number], domain: string, at: Timestamps) {
  return {
    attributeCode: item.attributeCode,
    attributeName: item.attributeName,
    entityScope: item.entityScope ?? 'customer',
    dataType: item.dataType ?? 'string',
    riskDimension: item.riskDimension ?? null,
    sourceType: item.sourceType ?? domain,
    availabilityStage: item.availabilityStage ?? null,
    buildPhase: item.buildPhase ?? null,
    dataClassificationCode: item.dataClassificationCode ?? null,
    requiresConsent: item.requiresConsent ?? false,
    isSensitive: item.isSensitive ?? false,
    isModelCandidate: item.isModelCandidate ?? false,
    allowedForCreditDecision: item.allowedForCreditDecision ?? false,
    allowedForFraudDecision: item.allowedForFraudDecision ?? false,
    legalReviewStatus: item.legalReviewStatus ?? 'pending',
    prohibitedReasonCode: null,
    fairnessReviewRequired: item.fairnessReviewRequired ?? false,
    retentionPolicyId: item.retentionPolicyId ?? null,
    isActive: true,
    ...at,
  };
}

export function toFeatureDefinitionRow(item: Definitions['features'][number], domain: string, at: Timestamps) {
  return {
    featureCode: item.featureCode,
    featureName: item.featureName,
    featureFamily: item.featureFamily ?? domain,
    riskDimension: item.riskDimension ?? null,
    dataType: item.dataType ?? 'number',
    availabilityTier: item.availabilityTier ?? null,
    buildPhase: item.buildPhase ?? null,
    dataClassificationCode: item.dataClassificationCode ?? null,
    calculationKind: item.calculationKind ?? null,
    defaultMissingStrategy: item.defaultMissingStrategy ?? null,
    isModelInput: item.isModelInput ?? false,
    isPolicyRuleInput: item.isPolicyRuleInput ?? false,
    isSensitive: item.isSensitive ?? false,
    allowedForCreditDecision: item.allowedForCreditDecision ?? false,
    allowedForFraudDecision: item.allowedForFraudDecision ?? false,
    legalReviewStatus: item.legalReviewStatus ?? 'pending',
    prohibitedReasonCode: null,
    fairnessReviewRequired: item.fairnessReviewRequired ?? false,
    retentionPolicyId: item.retentionPolicyId ?? null,
    ownerTeam: item.ownerTeam ?? null,
    isActive: true,
    ...at,
  };
}
