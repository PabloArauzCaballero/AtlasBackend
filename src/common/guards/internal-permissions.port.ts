/**
 * @file Puerto: contrato mínimo para consultar permisos finos de un usuario interno.
 * @business Esta pieza controla quién puede operar Atlas sin que cada dominio conozca las tablas de RBAC.
 * @system `InternalPermissionsGuard` depende de este puerto; `InternalUsersModule` lo implementa y lo exporta.
 */
export const INTERNAL_PERMISSIONS_CHECKER = Symbol('INTERNAL_PERMISSIONS_CHECKER');

export interface InternalPermissionsChecker {
  hasPermissions(tenantId: string, internalUserId: string, permissions: string[]): Promise<boolean>;
}
