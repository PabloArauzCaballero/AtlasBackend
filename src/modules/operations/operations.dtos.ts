import { PaginationMeta } from '../../common/utils/pagination/pagination.util.js';

export type ManualReviewCaseResponseDto = {
  id: string;
  tenantId: string;
  caseCode: string | null;
  customerId: string | null;
  riskAssessmentRunId: string | null;
  fraudCaseId: string | null;
  caseType: string | null;
  priority: string | null;
  status: string | null;
  openedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
};

export type FraudCaseResponseDto = {
  id: string;
  tenantId: string;
  caseCode: string | null;
  customerId: string | null;
  primaryDeviceId: string | null;
  caseStatus: string | null;
  severity: string | null;
  patternDetected: string | null;
  openedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
};

export type PaginatedManualReviewCasesResponseDto = {
  items: ManualReviewCaseResponseDto[];
  meta: PaginationMeta;
};

export type PaginatedFraudCasesResponseDto = {
  items: FraudCaseResponseDto[];
  meta: PaginationMeta;
};
