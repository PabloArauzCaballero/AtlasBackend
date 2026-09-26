/**
 * @file Permisos internos sobre el EXPEDIENTE del cliente.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system enumera los permisos internos de este grupo.
 */
import { permission, type InternalPermissionSeed } from './internal-rbac.permission-builder.js';

/**
 * Sus carpetas, sus archivos y quién puede verlos, más el permiso aparte que REVELA la PII que
 * contienen. No va con el gobierno del dato porque no es lo mismo: aquello decide qué se sabe del
 * catálogo, y esto quién abre la carpeta de una persona concreta.
 */
export const RECORDS_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'expedientes.leer',
    module: 'expedientes',
    resource: 'expediente',
    action: 'read',
    description: 'Ver el árbol de un expediente, abrir sus archivos y su actividad.',
    riskLevel: 'MEDIUM',
  }),
  permission({
    code: 'expedientes.escribir',
    module: 'expedientes',
    resource: 'expediente',
    action: 'write',
    description: 'Subir, crear carpetas, renombrar, mover y enviar a la papelera.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'expedientes.compartir',
    module: 'expedientes',
    resource: 'expediente',
    action: 'share',
    description: 'Conceder y revocar acceso a carpetas y archivos de un expediente.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'expedientes.administrar',
    module: 'expedientes',
    resource: 'expediente',
    action: 'admin',
    description: 'Purgar la papelera, congelar y conceder administración de un expediente.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'expedientes.pii.revelar',
    module: 'expedientes',
    resource: 'expediente_pii',
    action: 'reveal',
    description: 'Ver sin enmascarar los contactos y referencias del expediente.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
];
