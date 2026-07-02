import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerModel,
  CustomerProfileVersionModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  RiskAssessmentResultModel,
} from '../../database/models/index.js';
import {
  ConsentSummaryDto,
  ContactSummaryDto,
  FraudCaseSummaryDto,
  InvestigationSummaryResponseDto,
  ManualReviewSummaryDto,
  RiskSummaryDto,
  WorkQueueItemDto,
} from './operations.dtos.js';

function toIsoOrNull(date: Date | string | null): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : date;
}

function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toManualReviewWorkItem(caseModel: ManualReviewCaseModel): WorkQueueItemDto {
  return {
    workItemType: 'manual_review',
    caseId: String(caseModel.id),
    caseCode: caseModel.caseCode,
    customerId: caseModel.customerId === null ? null : String(caseModel.customerId),
    priority: caseModel.priority,
    status: caseModel.status,
    reasonCode: caseModel.caseType,
    openedAt: toIsoOrNull(caseModel.openedAt),
    createdAt: caseModel.createdAtValue.toISOString(),
  };
}

export function toFraudWorkItem(caseModel: FraudCaseModel): WorkQueueItemDto {
  return {
    workItemType: 'fraud',
    caseId: String(caseModel.id),
    caseCode: caseModel.caseCode,
    customerId: caseModel.customerId === null ? null : String(caseModel.customerId),
    priority: caseModel.severity,
    status: caseModel.caseStatus,
    reasonCode: caseModel.patternDetected,
    openedAt: toIsoOrNull(caseModel.openedAt),
    createdAt: caseModel.createdAtValue.toISOString(),
  };
}

export function toInvestigationSummaryResponse(input: {
  customer: CustomerModel;
  profile: CustomerProfileVersionModel | null;
  contacts: CustomerContactMethodModel[];
  consents: CustomerConsentModel[];
  latestRiskResult: RiskAssessmentResultModel | null;
  manualReviewCases: ManualReviewCaseModel[];
  fraudCases: FraudCaseModel[];
}): InvestigationSummaryResponseDto {
  const contacts: ContactSummaryDto[] = input.contacts.map((c) => ({
    contactType: c.contactType,
    status: c.status,
    isPrimary: c.isPrimary,
    valueLast4: c.valueLast4,
  }));

  const consents: ConsentSummaryDto[] = input.consents.map((c) => ({
    purposeCode: c.purposeCode,
    granted: c.granted,
    grantedAt: toIsoOrNull(c.grantedAt),
    revokedAt: toIsoOrNull(c.revokedAt),
  }));

  const latestRiskAssessment: RiskSummaryDto | null = input.latestRiskResult
    ? {
        riskAssessmentRunId: String(input.latestRiskResult.riskAssessmentRunId),
        assessmentType: input.latestRiskResult.assessmentType,
        recommendedAction: input.latestRiskResult.recommendedAction,
        riskLevel: input.latestRiskResult.riskLevel,
        fraudScore: toNumberOrNull(input.latestRiskResult.fraudScore),
        decidedAt: toIsoOrNull(input.latestRiskResult.decidedAt),
      }
    : null;

  const manualReviewCases: ManualReviewSummaryDto[] = input.manualReviewCases.map((c) => ({
    caseId: String(c.id),
    caseCode: c.caseCode,
    caseType: c.caseType,
    priority: c.priority,
    status: c.status,
    openedAt: toIsoOrNull(c.openedAt),
  }));

  const fraudCases: FraudCaseSummaryDto[] = input.fraudCases.map((c) => ({
    caseId: String(c.id),
    caseCode: c.caseCode,
    severity: c.severity,
    caseStatus: c.caseStatus,
    openedAt: toIsoOrNull(c.openedAt),
  }));

  return {
    customer: {
      customerId: String(input.customer.id),
      customerCode: input.customer.customerCode,
      status: input.customer.lifecycleStatus,
      phoneLast4: input.customer.primaryPhoneLast4,
      emailDomain: input.customer.primaryEmailDomain,
      createdAt: input.customer.createdAtValue.toISOString(),
    },
    profile: input.profile
      ? {
          firstName: input.profile.firstName,
          lastName: input.profile.lastName,
          birthDate: input.profile.birthDate,
          preferredLanguage: input.profile.preferredLanguage,
        }
      : null,
    contacts,
    consents,
    latestRiskAssessment,
    manualReviewCases,
    fraudCases,
  };
}
