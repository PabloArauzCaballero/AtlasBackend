/**
 * @file Mapper: arma el perfil de acceso de un usuario interno a partir de sus filas rol-permiso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { InternalUserModel } from '../../database/models/index.js';
import { expandPermissionAliases } from '../../common/utils/permission-aliases.js';
import type { InternalAccessProfile } from './internal-users.types.js';

export type InternalRolePermissionRow = {
  roleCode: string;
  legacyRoleCode: string | null;
  permissionCode: string | null;
};

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}

export function mapAccessProfile(user: InternalUserModel, rows: readonly InternalRolePermissionRow[]): InternalAccessProfile {
  const permissions = expandPermissionAliases(uniqueSorted(rows.map((row) => row.permissionCode)));
  return {
    user: {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email ?? '',
      fullName: user.fullName ?? '',
      name: user.fullName ?? '',
      userCode: user.userCode,
      status: user.status ?? 'unknown',
      department: user.department,
      jobTitle: user.jobTitle,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
      roles: uniqueSorted(rows.map((row) => row.roleCode)),
      legacyRoles: uniqueSorted(rows.map((row) => row.legacyRoleCode)),
      permissions,
    },
  };
}

export function groupRolePermissionRowsByUser(
  rows: ReadonlyArray<InternalRolePermissionRow & { internalUserId: string }>,
): Map<string, InternalRolePermissionRow[]> {
  const rowsByUser = new Map<string, InternalRolePermissionRow[]>();
  for (const row of rows) {
    const existing = rowsByUser.get(row.internalUserId);
    if (existing) {
      existing.push(row);
    } else {
      rowsByUser.set(row.internalUserId, [row]);
    }
  }
  return rowsByUser;
}
