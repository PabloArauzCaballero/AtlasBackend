import { PaginationMeta } from '../../common/utils/pagination/pagination.util.js';

export type WorkQueueItemDto = {
  workItemType: 'manual_review' | 'fraud';
  caseId: string;
  caseCode: string | null;
  customerId: string | null;
  priority: string | null;
  status: string | null;
  reasonCode: string | null;
  openedAt: string | null;
  createdAt: string;
};

export type PaginatedWorkQueueResponseDto = {
  items: WorkQueueItemDto[];
  meta: PaginationMeta;
};

export type ContactSummaryDto = {
  contactType: string | null;
  status: string | null;
  isPrimary: boolean | null;
  valueLast4: string | null;
};

export type ConsentSummaryDto = {
  purposeCode: string | null;
  granted: boolean | null;
  grantedAt: string | null;
  revokedAt: string | null;
};

export type RiskSummaryDto = {
  riskAssessmentRunId: string;
  assessmentType: string | null;
  recommendedAction: string | null;
  riskLevel: string | null;
  fraudScore: number | null;
  decidedAt: string | null;
};

export type ManualReviewSummaryDto = {
  caseId: string;
  caseCode: string | null;
  caseType: string | null;
  priority: string | null;
  status: string | null;
  openedAt: string | null;
};

export type FraudCaseSummaryDto = {
  caseId: string;
  caseCode: string | null;
  severity: string | null;
  caseStatus: string | null;
  openedAt: string | null;
};

export type InvestigationSummaryResponseDto = {
  customer: {
    customerId: string;
    customerCode: string | null;
    status: string | null;
    phoneLast4: string | null;
    emailDomain: string | null;
    createdAt: string;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    preferredLanguage: string | null;
  } | null;
  contacts: ContactSummaryDto[];
  consents: ConsentSummaryDto[];
  latestRiskAssessment: RiskSummaryDto | null;
  manualReviewCases: ManualReviewSummaryDto[];
  fraudCases: FraudCaseSummaryDto[];
};
