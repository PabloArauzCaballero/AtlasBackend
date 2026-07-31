/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
export { INTERNAL_ROLE_CODES, INTERNAL_ROLE_SEEDS, legacyRoleForInternalRoles } from './internal-rbac.roles.js';
export type { InternalRoleCode, InternalRoleSeed } from './internal-rbac.roles.js';
export { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from './internal-rbac.permissions.js';
export type { InternalPermissionSeed } from './internal-rbac.permissions.js';
