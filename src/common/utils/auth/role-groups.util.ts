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

/**
 * Quién lee y quién cambia lo que se le dice al cliente —el catálogo de avisos y el contenido de la
 * app—, alineado con el catálogo RBAC interno.
 *
 * El portal enseña esas pantallas a quien tiene `governance.policies.read` (cumplimiento y auditoría
 * incluidos) y el botón de guardar a quien tiene `governance.policies.manage`, que sólo tienen los
 * roles de administración. Hasta el 2026-09-28 la lista de roles era otra: cumplimiento y auditoría
 * veían las entradas del menú y recibían 403, y un agente de soporte o de cobranza podía declarar
 * irrenunciable —o dejar de declarar— el aviso de mora, o reescribir las preguntas frecuentes, con una
 * llamada directa a la API.
 */
export const GOVERNANCE_POLICY_READ_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'readonly_auditor',
  'admin',
  'platform_admin',
] as const;
export const GOVERNANCE_POLICY_WRITE_ROLES = ['admin', 'platform_admin'] as const;

export function isInternalOperationalRole(role: AuthenticatedUser['role']): boolean {
  return (INTERNAL_OPERATIONAL_ROLES as readonly string[]).includes(role);
}

export function isInternalOrSystemRole(role: AuthenticatedUser['role']): boolean {
  return (INTERNAL_SYSTEM_ROLES as readonly string[]).includes(role);
}
