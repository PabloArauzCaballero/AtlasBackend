/**
 * @file Puerto de persistencia de evaluaciones de Riesgo (AT-027).
 * @business Corrida, features, evidencia de decisión y resultado se escriben juntos o no se escriben.
 * @system Hoy lo sirve `RiskRepository` dentro de la transacción de `RiskService`; este tipo recorta lo
 *   que el caso de uso usa para escribir, de modo que un adaptador alternativo tenga un contrato finito.
 */
import type { RiskRepository } from '../../risk.repository.js';

export type RiskAssessmentStorePort = Pick<
  RiskRepository,
  | 'createRiskAssessmentRun'
  | 'createRiskAssessmentContext'
  | 'createFeatureSnapshot'
  | 'createRuleFired'
  | 'createContribution'
  | 'createRiskResult'
  | 'createAudit'
  | 'findLatestCustomerRiskResult'
>;

export const RISK_ASSESSMENT_STORE_PORT = 'atlas.risk.assessment-store-port';
