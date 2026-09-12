/**
 * @file Permisos internos sobre PERSONAS y su acceso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system enumera los permisos internos de este grupo.
 */
import { permission, type InternalPermissionSeed } from './internal-rbac.permission-builder.js';

/**
 * Identidades internas y de comercio, expedientes de comercio, y la matriz de roles y permisos con
 * la que se concede todo lo demás. Es la parte que decide QUIÉN entra.
 */
export const PEOPLE_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'internal.users.read',
    module: 'internal',
    resource: 'internal_user',
    action: 'read',
    description: 'Consultar usuarios internos.',
  }),
  permission({
    code: 'merchant.users.read',
    module: 'merchant',
    resource: 'merchant_user',
    action: 'read',
    description: 'Consultar identidades de usuarios de comercios afiliados.',
  }),
  permission({
    code: 'merchant.users.manage',
    module: 'merchant',
    resource: 'merchant_user',
    action: 'manage',
    description: 'Conceder o rechazar el acceso pedido por el ERP, y activar, suspender o dar de baja el de un usuario de comercio.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'merchant.users.request',
    module: 'merchant',
    resource: 'merchant_user',
    action: 'request',
    description: 'Encolar una petición de alta de identidad de comercio. Lo usa el ERP, no el portal interno.',
    // Pedir no es conceder: separado de `manage` justamente para que el sistema que pide no pueda
    // además aprobarse a sí mismo. Es la razón de ser de la cola.
    riskLevel: 'MEDIUM',
  }),
  permission({
    code: 'partner.kyb.request',
    module: 'merchant',
    resource: 'partner_profile',
    action: 'request',
    description:
      'Pedir al Motor la verificación del expediente de un comercio, y enlazar el expediente con su cuenta del ERP. Lo usa el ERP, no el portal interno.',
    // Pedir no es decidir: la verificación la resuelve el Motor y, cuando abre caso, una persona en
    // su cola. Este permiso sólo abre la puerta a PEDIRLA, igual que `merchant.users.request`.
    riskLevel: 'MEDIUM',
  }),
  permission({
    code: 'internal.users.manage',
    module: 'internal',
    resource: 'internal_user',
    action: 'manage',
    description: 'Crear, editar, suspender y gestionar usuarios internos.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'internal.roles.read',
    module: 'internal',
    resource: 'internal_role',
    action: 'read',
    description: 'Consultar roles internos.',
  }),
  permission({
    code: 'internal.roles.manage',
    module: 'internal',
    resource: 'internal_role',
    action: 'manage',
    description: 'Administrar roles internos.',
    riskLevel: 'CRITICAL',
    requiresReason: true,
  }),
  permission({
    code: 'internal.permissions.read',
    module: 'internal',
    resource: 'internal_permission',
    action: 'read',
    description: 'Consultar permisos internos.',
  }),
];
