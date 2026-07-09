export type AtlasUserRole =
  | 'customer'
  | 'internal_operator'
  | 'risk_analyst'
  | 'compliance_analyst'
  | 'fraud_analyst'
  | 'system'
  | 'system_admin'
  | 'qa_engineer'
  | 'devops'
  | 'readonly_auditor'
  | 'merchant'
  | 'admin'
  | 'platform_admin';

export type AuthenticatedUser = {
  sub: string;
  tenantId?: string;
  customerId?: string;
  internalUserId?: string;
  platformUserId?: string;
  role: AtlasUserRole;
  tokenVersion?: number;
};

export type RequestWithAuth = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  ip?: string;
  correlationId?: string;
};
