/**
 * @file Utilidad pura: de cuándo son las variables de capacidad que el recálculo de línea añade.
 * @business El motor no concede sobre un dato crítico cuya antigüedad no se puede comprobar; una
 *   línea recalculada declara de cuándo es su capacidad igual que lo hace el alta original.
 * @system extiende el `variableMetadata` de `UnderwritingFeaturesService` con las fechas propias
 *   del recálculo de línea (capacidad, antigüedad, fidelización), sin inventar una fecha que no se
 *   conoce.
 */
import type { VariableMetadata } from './decision-engine.types.js';
import type { UnderwritingFeatures } from './underwriting-features.service.js';

/** Las variables de la propuesta de capacidad que salen del ingreso o del extracto. */
const CAPACITY_FROM_EVIDENCE = [
  'capacity_recommended_limit',
  'capacity_monthly_installment',
  'capacity_binding_constraint',
  'capacity_evidence_source',
] as const;

/**
 * La capacidad medida con EXTRACTO no lleva fecha: aquí no se conoce la del extracto y no se inventa
 * (el motor la marcará desconocida). La estimada con lo DECLARADO vale lo que la captura económica.
 * Antigüedad, fidelización y relación se leen en vivo del libro (ya fechadas en el expediente).
 */
export function lineVariableMetadata(features: UnderwritingFeatures, evidence: string): VariableMetadata {
  const metadata: VariableMetadata = { ...features.variableMetadata };
  const economy = features.observedAt.economy;
  if (evidence !== 'EXTRACTO' && economy) {
    for (const code of CAPACITY_FROM_EVIDENCE) metadata[code] = { observedAt: economy.toISOString() };
  }
  const now = features.variableMetadata.requested_amount?.observedAt;
  if (now) {
    for (const code of ['relationship_score', 'relationship_tier', 'tenure_score', 'loyalty_score']) {
      metadata[code] = { observedAt: now, fetchedAt: now };
    }
  }
  return metadata;
}
