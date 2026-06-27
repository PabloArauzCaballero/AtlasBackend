export type ConsentDocumentResponseDto = {
  id: string;
  tenantId: string;
  documentCode: string | null;
  versionCode: string | null;
  language: string | null;
  contentUrl: string | null;
  contentHash: string | null;
  requiresExplicitAction: boolean | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  status: string | null;
};

export type CustomerConsentResponseDto = {
  id: string;
  tenantId: string;
  customerId: string;
  consentDocumentId: string | null;
  purposeCode: string | null;
  granted: boolean | null;
  grantedAt: string | null;
  revokedAt: string | null;
  channel: string | null;
};
