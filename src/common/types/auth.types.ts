/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de types sin introducir reglas de un dominio específico.
 */
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
