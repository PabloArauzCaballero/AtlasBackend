import { AuthenticatedUser } from '../../types/auth.types.js';

export const INTERNAL_OPERATIONAL_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'admin',
  'platform_admin',
] as const;

export const INTERNAL_SYSTEM_ROLES = [...INTERNAL_OPERATIONAL_ROLES, 'system'] as const;

export function isInternalOperationalRole(role: AuthenticatedUser['role']): boolean {
  return (INTERNAL_OPERATIONAL_ROLES as readonly string[]).includes(role);
}

export function isInternalOrSystemRole(role: AuthenticatedUser['role']): boolean {
  return (INTERNAL_SYSTEM_ROLES as readonly string[]).includes(role);
}
