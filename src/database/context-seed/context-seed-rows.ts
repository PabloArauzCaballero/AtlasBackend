/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system traduce el paquete de contexto a las filas que esperan los upserts.
 */
import { assertRecord, rejectImportedNumericIds, requireString, validateItem } from './context-seed-validation.js';
import type { JsonRecord } from './context-seed.types.js';

export function sourceRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    source_code: requireString(item, 'sourceCode', `contextSources[${index}]`),
    source_name: item.sourceName,
    source_type: item.sourceType,
    reliability_score: item.reliabilityScore,
    refresh_frequency: item.refreshFrequency,
    notes: item.notes,
    is_active: item.isActive,
  }));
}

export function catalogRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    catalog_code: requireString(item, 'catalogCode', `contextCatalogs[${index}]`),
    catalog_name: item.catalogName,
    domain: item.domain,
    description: item.description,
    owner_team: item.ownerTeam,
    is_active: item.isActive,
  }));
}

export function versionRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    catalog_code: requireString(item, 'catalogCode', `contextCatalogVersions[${index}]`),
    version_code: requireString(item, 'versionCode', `contextCatalogVersions[${index}]`),
    status: item.status,
    valid_from: item.validFrom,
    valid_until: item.validUntil,
    created_by_type: item.createdByType,
    approved_by_type: item.approvedByType,
    approved_at: item.approvedAt,
    notes: item.notes,
  }));
}

export function itemRows(items: JsonRecord[], label: string): JsonRecord[] {
  return items.map((rawItem, index) => {
    const item = validateItem(rawItem, undefined, undefined, `${label}[${index}]`);
    return {
      catalog_code: item.catalogCode,
      version_code: item.versionCode,
      item_code: item.itemCode,
      item_name: item.itemName,
      item_type: item.itemType,
      attributes: item.attributes ?? {},
      source_code: item.sourceCode,
      confidence_score: item.confidenceScore,
      is_active: item.isActive,
    };
  });
}

export function aliasRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => {
    rejectImportedNumericIds(item, `aliases[${index}]`);
    assertRecord(item.contextItemRef, `aliases[${index}].contextItemRef`);
    const ref = item.contextItemRef;
    return {
      catalog_code: requireString(ref, 'catalogCode', `aliases[${index}].contextItemRef`),
      version_code: requireString(ref, 'versionCode', `aliases[${index}].contextItemRef`),
      item_code: requireString(ref, 'itemCode', `aliases[${index}].contextItemRef`),
      alias_value: item.aliasValue,
      alias_type: item.aliasType,
      normalized_alias: item.normalizedAlias,
      confidence_score: item.confidenceScore,
    };
  });
}

export function riskRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => {
    rejectImportedNumericIds(item, `riskMappings[${index}]`);
    assertRecord(item.contextItemRef, `riskMappings[${index}].contextItemRef`);
    const ref = item.contextItemRef;
    return {
      catalog_code: requireString(ref, 'catalogCode', `riskMappings[${index}].contextItemRef`),
      version_code: requireString(ref, 'versionCode', `riskMappings[${index}].contextItemRef`),
      item_code: requireString(ref, 'itemCode', `riskMappings[${index}].contextItemRef`),
      risk_dimension: item.riskDimension,
      risk_band: item.riskBand,
      score_points_suggested: item.scorePointsSuggested,
      reason_code: item.reasonCode,
      explanation: item.explanation,
      model_usage: item.modelUsage,
      valid_from: item.validFrom,
      valid_until: item.validUntil,
      allowed_for_direct_adverse_credit_action: item.allowedForDirectAdverseCreditAction,
      requires_calibration: item.requiresCalibration,
    };
  });
}
