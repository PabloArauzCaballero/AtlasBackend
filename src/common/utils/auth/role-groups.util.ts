/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de auth sin introducir reglas de un dominio específico.
 */
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
