/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin esto, un permiso nuevo existe en el código y NO en la base: la pantalla que depende de él responde 403.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../modules/internal-users/internal-rbac.permissions.js';

type MigrationContext = { context: QueryInterface };

const PERMISSIONS = `${atlasSchemaFor('internal_permissions')}.internal_permissions`;
const ROLES = `${atlasSchemaFor('internal_roles')}.internal_roles`;
const ROLE_PERMISSIONS = `${atlasSchemaFor('internal_role_permissions')}.internal_role_permissions`;

/**
 * Mismo motivo que `20260915140000-sync-internal-rbac-catalog-2`: el volcado de `20260821040000`
 * ya corrió, así que todo permiso declarado después (aquí, `credit.loan_disbursement.override_rate`,
 * Frente 3A) vive sólo en el código hasta que una migración lo vuelva a volcar.
 *
 * Es el MISMO volcado, idempotente (`ON CONFLICT`): actualiza los permisos existentes, inserta los
 * que falten y concede los que su rol declare. No revoca nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
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

/**
 * Sin vuelta atrás, por el mismo motivo que `20260915140000-sync-internal-rbac-catalog-2`: revocar
 * permisos que otras migraciones y seeds también conceden dejaría la base en un estado que nadie
 * declaró.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
