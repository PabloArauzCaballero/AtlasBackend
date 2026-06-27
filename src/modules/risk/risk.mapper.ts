import { RiskAssessmentResultModel } from '../../database/models/index.js';
import { RiskAssessmentResultResponseDto } from './risk.dtos.js';

export function toRiskAssessmentResultResponse(result: RiskAssessmentResultModel): RiskAssessmentResultResponseDto {
  return {
    id: String(result.id),
    tenantId: String(result.tenantId),
    riskAssessmentRunId: String(result.riskAssessmentRunId),
    customerId: result.customerId === null ? null : String(result.customerId),
    assessmentType: result.assessmentType,
    recommendedAction: result.recommendedAction,
    riskLevel: result.riskLevel,
    scoreTotal: result.scoreTotal,
    fraudScore: result.fraudScore,
    identityScore: result.identityScore,
    deviceRiskScore: result.deviceRiskScore,
    behaviorScore: result.behaviorScore,
    contactabilityScore: result.contactabilityScore,
    consistencyScore: result.consistencyScore,
    reasonCodes: result.reasonCodesJson,
    modelVersionCodeSnapshot: result.modelVersionCodeSnapshot,
    rulesetVersionCodeSnapshot: result.rulesetVersionCodeSnapshot,
    decidedAt: result.decidedAt ? result.decidedAt.toISOString() : null,
  };
}
