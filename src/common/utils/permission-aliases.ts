/**
 * @file Equivalencias entre códigos de permiso interno.
 * @business Un mismo permiso tiene nombres antiguos y nuevos; tratarlos como distintos negaría el acceso a quien sí lo tiene.
 * @system lo usan el guard de permisos (vía `InternalRbacRepository`) y la deriva de permisos de systems-ops, que tiene que decidir igual que el guard.
 */
export const permissionAliases: Readonly<Record<string, readonly string[]>> = {
  'internal.users.read': ['rbac.internal_users.read'],
  'internal.users.manage': [
    'rbac.internal_users.create',
    'rbac.internal_users.disable',
    'rbac.internal_users.manage_roles',
    'rbac.internal_users.update',
  ],
  'internal.roles.read': ['rbac.roles.read'],
  'internal.roles.manage': ['rbac.internal_users.manage_roles'],
  'internal.permissions.read': ['rbac.roles.read'],
};

export function expandPermissionAliases(permissions: string[]): string[] {
  const expanded = new Set(permissions);
  for (const [canonical, aliases] of Object.entries(permissionAliases)) {
    if (expanded.has(canonical) || aliases.some((alias) => expanded.has(alias))) {
      expanded.add(canonical);
      for (const alias of aliases) expanded.add(alias);
    }
  }
  return [...expanded].sort();
}

export function hasPermissionOrAlias(permissions: ReadonlySet<string>, requiredPermission: string): boolean {
  if (permissions.has(requiredPermission)) return true;
  return permissionAliases[requiredPermission]?.some((alias) => permissions.has(alias)) ?? false;
}
