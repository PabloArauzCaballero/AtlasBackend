/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';
import { AUDIT_QUALITY_NARRATIVES } from './audit-quality.fixtures.js';
import { COMMUNICATION_NARRATIVES } from './communications.fixtures.js';
import { CONTEXT_CATALOG_NARRATIVES } from './context-catalogs.fixtures.js';
import { CREDIT_LIFECYCLE_NARRATIVES } from './credit-lifecycle.fixtures.js';
import { CREDIT_RATING_NARRATIVES } from './credit-rating.fixtures.js';
import { DATA_NOTEBOOK_NARRATIVES } from './data-notebook.fixtures.js';
import { CUSTOMER_IDENTITY_NARRATIVES } from './customer-identity.fixtures.js';
import { DEVICE_INTELLIGENCE_NARRATIVES } from './device-intelligence.fixtures.js';
import { EVIDENCE_NARRATIVES } from './evidence.fixtures.js';
import { EXTERNAL_PROVIDER_NARRATIVES } from './external-providers.fixtures.js';
import { FRAUD_REVIEW_NARRATIVES } from './fraud-review.fixtures.js';
import { LOAN_BOOK_NARRATIVES } from './loan-book.fixtures.js';
import { ONBOARDING_BEHAVIOR_NARRATIVES } from './onboarding-behavior.fixtures.js';
import { PLATFORM_ACCESS_NARRATIVES } from './platform-access.fixtures.js';
import { PRIVACY_CONSENT_NARRATIVES } from './privacy-consent.fixtures.js';
import { RISK_SCORING_NARRATIVES } from './risk-scoring.fixtures.js';
import { SYSTEMS_GOVERNANCE_NARRATIVES } from './systems-governance.fixtures.js';
import { WORKFLOW_CATALOG_NARRATIVES } from './workflow-catalog.fixtures.js';

export type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Narrativa curada a mano, por tabla. El orden es irrelevante: la clave es `tableName`. */
export const ENTITY_BUSINESS_NARRATIVES: readonly EntityBusinessNarrative[] = [
  ...PLATFORM_ACCESS_NARRATIVES,
  ...CUSTOMER_IDENTITY_NARRATIVES,
  ...PRIVACY_CONSENT_NARRATIVES,
  ...EVIDENCE_NARRATIVES,
  ...DEVICE_INTELLIGENCE_NARRATIVES,
  ...ONBOARDING_BEHAVIOR_NARRATIVES,
  ...RISK_SCORING_NARRATIVES,
  ...FRAUD_REVIEW_NARRATIVES,
  ...CONTEXT_CATALOG_NARRATIVES,
  ...EXTERNAL_PROVIDER_NARRATIVES,
  ...COMMUNICATION_NARRATIVES,
  ...AUDIT_QUALITY_NARRATIVES,
  ...SYSTEMS_GOVERNANCE_NARRATIVES,
  ...CREDIT_LIFECYCLE_NARRATIVES,
  ...LOAN_BOOK_NARRATIVES,
  ...CREDIT_RATING_NARRATIVES,
  ...DATA_NOTEBOOK_NARRATIVES,
  ...WORKFLOW_CATALOG_NARRATIVES,
];

/**
 * Índice por nombre de tabla. Se construye una sola vez y falla en la carga del módulo si dos
 * archivos declararon la misma tabla: un duplicado silencioso haría que la narrativa sembrada
 * dependa del orden de los imports, que es exactamente el tipo de bug que nadie encuentra después.
 */
export const ENTITY_NARRATIVE_BY_TABLE: ReadonlyMap<string, EntityBusinessNarrative> = (() => {
  const index = new Map<string, EntityBusinessNarrative>();
  for (const narrative of ENTITY_BUSINESS_NARRATIVES) {
    if (index.has(narrative.tableName)) {
      throw new Error(`Narrativa duplicada para la tabla "${narrative.tableName}" en entity-narratives/.`);
    }
    index.set(narrative.tableName, narrative);
  }
  return index;
})();
