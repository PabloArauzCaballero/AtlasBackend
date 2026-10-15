/**
 * @file Constantes SQL: lectura de roles y permisos efectivos de usuarios internos.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */

/** Roles y permisos activos de UN usuario interno (`:tenantId`, `:internalUserId`). */
export const ROLE_PERMISSIONS_FOR_USER_SQL = `
  SELECT r.role_code AS "roleCode", r.legacy_role_code AS "legacyRoleCode", p.permission_code AS "permissionCode"
  FROM internal_user_roles ur
  JOIN internal_roles r
    ON r._id = ur.role_id
   AND r.status = 'active'
   AND r._deleted = false
  LEFT JOIN internal_role_permissions rp
    ON rp.role_id = r._id
  LEFT JOIN internal_permissions p
    ON p._id = rp.permission_id
   AND p.status = 'active'
   AND p._deleted = false
  WHERE ur._tenant_id = :tenantId
    AND ur.internal_user_id = :internalUserId
    AND ur.revoked_at IS NULL
  ORDER BY r.role_code ASC, p.permission_code ASC
`;

/** Lo mismo para varios usuarios a la vez (`:internalUserIds`), ordenado por usuario. */
export const ROLE_PERMISSIONS_FOR_USERS_SQL = `
  SELECT ur.internal_user_id AS "internalUserId",
         r.role_code AS "roleCode", r.legacy_role_code AS "legacyRoleCode", p.permission_code AS "permissionCode"
  FROM internal_user_roles ur
  JOIN internal_roles r
    ON r._id = ur.role_id
   AND r.status = 'active'
   AND r._deleted = false
  LEFT JOIN internal_role_permissions rp
    ON rp.role_id = r._id
  LEFT JOIN internal_permissions p
    ON p._id = rp.permission_id
   AND p.status = 'active'
   AND p._deleted = false
  WHERE ur._tenant_id = :tenantId
    AND ur.internal_user_id IN (:internalUserIds)
    AND ur.revoked_at IS NULL
  ORDER BY ur.internal_user_id ASC, r.role_code ASC, p.permission_code ASC
`;
