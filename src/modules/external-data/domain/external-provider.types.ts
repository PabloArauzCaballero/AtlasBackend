export type ExternalProviderMode = 'mock_local' | 'mock_server' | 'sandbox' | 'production' | 'disabled';

export type ExternalProviderCode =
  | 'SEGIP'
  | 'CGIP'
  | 'INFOCENTER'
  | 'QR_GENERIC'
  | 'QR_BCB_GENERIC'
  | 'BANKING_GENERIC'
  | 'TELCO_GENERIC'
  | 'FACEBOOK_META'
  | 'WHATSAPP_GENERIC'
  | 'DIGITAL_TRUST_GENERIC';

export type ExternalProviderStatus =
  | 'PENDING'
  | 'BLOCKED_BY_COST_POLICY'
  | 'CONSENT_REQUIRED'
  | 'MANUAL_APPROVAL_REQUIRED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'MOCKED'
  | 'DATA_NOT_AVAILABLE'
  | 'CACHED';

export type ProviderHealthStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';

export type ExternalProviderScenario =
  | 'happy_path'
  | 'provider_down'
  | 'timeout'
  | 'slow_response'
  | 'invalid_payload'
  | 'unauthorized'
  | 'rate_limited'
  | 'not_found'
  | 'partial_match'
  | 'data_not_available'
  | 'manual_review_required'
  | 'cost_blocked'
  | 'duplicate_request'
  | 'provider_internal_error'
  | 'fraud_signal_high'
  | 'low_confidence'
  | 'expired_token'
  | 'revoked_consent';

export type DecisionStage =
  'ONBOARDING' | 'CREDIT_APPLICATION' | 'MANUAL_REVIEW' | 'LIMIT_INCREASE' | 'FRAUD_REVIEW' | 'PAYMENT_RECONCILIATION' | 'CONTACTABILITY';

export type QueryType =
  | 'IDENTITY_VERIFICATION'
  | 'CREDIT_REPORT'
  | 'CREDIT_SCORE'
  | 'HIGH_RISK_REVIEW'
  | 'LIMIT_INCREASE'
  | 'FRAUD_INVESTIGATION'
  | 'PAYMENT_STATUS'
  | 'PAYMENT_VERIFICATION'
  | 'BANK_TRANSFER_VERIFICATION'
  | 'BANK_ACCOUNT_CHECK'
  | 'PHONE_TRUST_CHECK'
  | 'SOCIAL_TRUST_CHECK'
  | 'WHATSAPP_OTP_VERIFICATION'
  | 'DIGITAL_TRUST_CHECK';

export type ProviderHealthResult = {
  providerCode: string;
  status: ProviderHealthStatus;
  mode: ExternalProviderMode;
  latencyMs: number;
  checkedAt: string;
  errorCode?: string;
  errorMessageSafe?: string;
};

export type ExternalProviderExecutionInput = {
  tenantId: string;
  customerId?: string;
  providerCode: string;
  queryType: QueryType;
  purpose: string;
  decisionStage: DecisionStage;
  mode: ExternalProviderMode;
  input: Record<string, unknown>;
  scenario?: ExternalProviderScenario;
  idempotencyKey?: string;
  requestedByUserId?: string;
  approvedByAdminId?: string;
  mockBaseUrl?: string;
};

export type ExternalProviderRawResult = {
  providerCode: string;
  status: string;
  statusCode?: number;
  providerReference?: string;
  payload: Record<string, unknown>;
  latencyMs: number;
  isMocked: boolean;
};

export type NormalizedExternalObservation = {
  observationKey: string;
  valueType: 'BOOLEAN' | 'NUMBER' | 'STRING' | 'DATE' | 'JSON';
  valueBoolean?: boolean;
  valueNumber?: number;
  valueString?: string;
  valueDate?: string;
  valueJson?: Record<string, unknown>;
  confidenceScore?: number;
  verified?: boolean;
  manualReviewRequired?: boolean;
  featureNamespace: string;
  featureKey: string;
};

export type ExternalDataRequestResult = {
  requestId: string | null;
  providerCode: string;
  status: ExternalProviderStatus;
  reasonCode?: string;
  observations: NormalizedExternalObservation[];
  features: Record<string, unknown>;
  manualReviewRequired: boolean;
  modeUsed: ExternalProviderMode;
};
