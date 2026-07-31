/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.
 */
export type RiskAssessmentResultResponseDto = {
  id: string;
  tenantId: string;
  riskAssessmentRunId: string;
  customerId: string | null;
  assessmentType: string | null;
  recommendedAction: string | null;
  riskLevel: string | null;
  scoreTotal: number | null;
  fraudScore: number | null;
  identityScore: number | null;
  deviceRiskScore: number | null;
  behaviorScore: number | null;
  contactabilityScore: number | null;
  consistencyScore: number | null;
  reasonCodes: unknown | null;
  modelVersionCodeSnapshot: string | null;
  rulesetVersionCodeSnapshot: string | null;
  decidedAt: string | null;
};
