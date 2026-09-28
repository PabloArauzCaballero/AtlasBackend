/**
 * @file Permisos internos sobre las SOLICITUDES de derechos del titular.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system enumera los permisos internos de este grupo.
 */
import { permission, type InternalPermissionSeed } from './internal-rbac.permission-builder.js';

/**
 * Hallazgo A5 (plan `_plan-documentar-procesos-y-cableado-portal-2026-09-26`): la app creaba la
 * solicitud y nadie podía verla ni cerrarla. Leer la cola y moverla de estado son dos permisos y no
 * uno porque son dos responsabilidades: el analista de cumplimiento vigila los plazos; cerrar una
 * solicitud —lo que se le contesta al titular— es de la jefatura. Ninguno de los dos borra datos.
 */
export const PRIVACY_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'privacy.requests.read',
    module: 'privacy',
    resource: 'requests',
    action: 'read',
    description: 'Ver la cola de solicitudes de derechos del titular, su plazo legal y su historial.',
    riskLevel: 'MEDIUM',
  }),
  permission({
    code: 'privacy.requests.manage',
    module: 'privacy',
    resource: 'requests',
    action: 'manage',
    description:
      'Tomar, completar o rechazar una solicitud de derechos del titular. Cerrarla exige motivo; no borra datos: la supresión sigue siendo manual.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
];
