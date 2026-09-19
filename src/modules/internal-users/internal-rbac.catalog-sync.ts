/**
 * @file Utilidad de dominio reutilizable por las migraciones de catálogo RBAC.
 * @business Devuelve al catálogo de permisos lo que el código ya exige y la base todavía no tenía.
 * @system sincroniza internal_permissions y sus concesiones por rol con la lista canónica del código, de forma convergente e idempotente.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from './internal-rbac.permissions.js';

const PERMISSIONS = `${atlasSchemaFor('internal_permissions')}.internal_permissions`;
const ROLES = `${atlasSchemaFor('internal_roles')}.internal_roles`;
const ROLE_PERMISSIONS = `${atlasSchemaFor('internal_role_permissions')}.internal_role_permissions`;

/**
 * Lleva el catálogo de la base a lo que el código declara — todo, no sólo lo que falta hoy.
 *
 * ## Por qué existe como función y no dentro de una migración
 *
 * El catálogo de permisos se siembra por migración, no por sembrador: el sembrador trunca las
 * tablas de negocio al empezar, así que recuperar dos filas de referencia se llevaría por delante
 * clientes y expedientes. Pero una migración corre UNA vez: cada permiso que el código añade después
 * de esa corrida no llega nunca a una base viva. La solución cada vez que el código gana permisos es
 * una migración nueva que vuelva a converger — y para que esas migraciones no dupliquen cuarenta
 * líneas de SQL que pueden divergir, la convergencia vive aquí, en un solo sitio.
 *
 * `ON CONFLICT DO UPDATE` en el catálogo y `DO NOTHING` en las concesiones: reejecutarla no rompe
 * nada y la base termina en lo que el código dice, sin importar cuántas veces se haya corrido antes.
 */
export async function syncInternalRbacCatalog(queryInterface: QueryInterface): Promise<void> {
  const now = new Date().toISOString();

  for (const permission of INTERNAL_PERMISSION_SEEDS) {
    await queryInterface.sequelize.query(
      `
INSERT INTO ${PERMISSIONS} (
  permission_code, module_code, resource_code, action_code, description, risk_level,
  requires_reason, requires_mfa, is_system_permission, status, _created_at, _updated_at, _deleted
)
VALUES (
  :permissionCode, :moduleCode, :resourceCode, :actionCode, :description, :riskLevel,
  :requiresReason, false, true, 'active', :now, :now, false
)
ON CONFLICT (permission_code) WHERE _deleted = false
DO UPDATE SET
  module_code = EXCLUDED.module_code,
  resource_code = EXCLUDED.resource_code,
  action_code = EXCLUDED.action_code,
  description = EXCLUDED.description,
  risk_level = EXCLUDED.risk_level,
  requires_reason = EXCLUDED.requires_reason,
  status = 'active',
  _updated_at = EXCLUDED._updated_at;`,
      {
        replacements: {
          permissionCode: permission.code,
          moduleCode: permission.module,
          resourceCode: permission.resource,
          actionCode: permission.action,
          description: permission.description,
          riskLevel: permission.riskLevel,
          requiresReason: permission.requiresReason,
          now,
        },
      },
    );
  }

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSION_CODES)) {
    for (const permissionCode of permissionCodes) {
      await queryInterface.sequelize.query(
        `
INSERT INTO ${ROLE_PERMISSIONS} (role_id, permission_id, created_by_internal_user_id, _created_at)
SELECT r._id, p._id, NULL, :now
FROM ${ROLES} r
JOIN ${PERMISSIONS} p ON p.permission_code = :permissionCode AND p._deleted = false
WHERE r.role_code = :roleCode AND r._deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        { replacements: { roleCode, permissionCode, now } },
      );
    }
  }
}
