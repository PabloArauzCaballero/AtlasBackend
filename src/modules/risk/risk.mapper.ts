import { RiskAssessmentResultModel } from '../../database/models/index.js';
import { RiskAssessmentResultResponseDto } from './risk.dtos.js';
import { toNumberOrNull } from '../../common/utils/numbers/number.util.js';

export function toRiskAssessmentResultResponse(result: RiskAssessmentResultModel): RiskAssessmentResultResponseDto {
  return {
    id: String(result.id),
    tenantId: String(result.tenantId),
    riskAssessmentRunId: String(result.riskAssessmentRunId),
    customerId: result.customerId === null ? null : String(result.customerId),
    assessmentType: result.assessmentType,
    recommendedAction: result.recommendedAction,
    riskLevel: result.riskLevel,
    scoreTotal: toNumberOrNull(result.scoreTotal),
    fraudScore: toNumberOrNull(result.fraudScore),
    identityScore: toNumberOrNull(result.identityScore),
    deviceRiskScore: toNumberOrNull(result.deviceRiskScore),
    behaviorScore: toNumberOrNull(result.behaviorScore),
    contactabilityScore: toNumberOrNull(result.contactabilityScore),
    consistencyScore: toNumberOrNull(result.consistencyScore),
    reasonCodes: result.reasonCodesJson,
    modelVersionCodeSnapshot: result.modelVersionCodeSnapshot,
    rulesetVersionCodeSnapshot: result.rulesetVersionCodeSnapshot,
    decidedAt: result.decidedAt ? result.decidedAt.toISOString() : null,
  };
}
