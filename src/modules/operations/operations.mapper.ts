import { FraudCaseModel, ManualReviewCaseModel } from '../../database/models/index.js';
import { FraudCaseResponseDto, ManualReviewCaseResponseDto } from './operations.dtos.js';

function toIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function toManualReviewCaseResponse(caseModel: ManualReviewCaseModel): ManualReviewCaseResponseDto {
  return {
    id: String(caseModel.id),
    tenantId: String(caseModel.tenantId),
    caseCode: caseModel.caseCode,
    customerId: caseModel.customerId === null ? null : String(caseModel.customerId),
    riskAssessmentRunId: caseModel.riskAssessmentRunId === null ? null : String(caseModel.riskAssessmentRunId),
    fraudCaseId: caseModel.fraudCaseId === null ? null : String(caseModel.fraudCaseId),
    caseType: caseModel.caseType,
    priority: caseModel.priority,
    status: caseModel.status,
    openedAt: toIsoOrNull(caseModel.openedAt),
    closedAt: toIsoOrNull(caseModel.closedAt),
    resolution: caseModel.resolution,
  };
}

export function toFraudCaseResponse(caseModel: FraudCaseModel): FraudCaseResponseDto {
  return {
    id: String(caseModel.id),
    tenantId: String(caseModel.tenantId),
    caseCode: caseModel.caseCode,
    customerId: caseModel.customerId === null ? null : String(caseModel.customerId),
    primaryDeviceId: caseModel.primaryDeviceId === null ? null : String(caseModel.primaryDeviceId),
    caseStatus: caseModel.caseStatus,
    severity: caseModel.severity,
    patternDetected: caseModel.patternDetected,
    openedAt: toIsoOrNull(caseModel.openedAt),
    closedAt: toIsoOrNull(caseModel.closedAt),
    resolution: caseModel.resolution,
  };
}
