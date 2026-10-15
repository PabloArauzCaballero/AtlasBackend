/**
 * @file Puerto de persistencia de evaluaciones de Riesgo (AT-027).
 * @business Corrida, features, evidencia de decisión y resultado se escriben juntos o no se escriben.
 * @system Hoy lo sirven `RiskAssessmentRepository`, `RiskFeatureEvidenceRepository` y `RiskAuditRepository` dentro de la transacción de `RiskService`; este tipo recorta lo
 *   que el caso de uso usa para escribir, de modo que un adaptador alternativo tenga un contrato finito.
 */
import type { RiskAssessmentRepository } from '../../repositories/risk-assessment.repository.js';
import type { RiskAuditRepository } from '../../repositories/risk-audit.repository.js';
import type { RiskFeatureEvidenceRepository } from '../../repositories/risk-feature-evidence.repository.js';

export type RiskAssessmentStorePort = Pick<
  RiskAssessmentRepository,
  | 'createRiskAssessmentRun'
  | 'createRiskAssessmentContext'
  | 'createRuleFired'
  | 'createContribution'
  | 'createRiskResult'
  | 'findLatestCustomerRiskResult'
> &
  Pick<RiskFeatureEvidenceRepository, 'createFeatureSnapshot'> &
  Pick<RiskAuditRepository, 'createAudit'>;

export const RISK_ASSESSMENT_STORE_PORT = 'atlas.risk.assessment-store-port';
