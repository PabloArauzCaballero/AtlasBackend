import { QueryInterface, Transaction } from 'sequelize';
import {
  INTERNAL_PERMISSION_SEEDS,
  INTERNAL_ROLE_SEEDS,
  ROLE_PERMISSION_CODES,
} from '../../../modules/internal-users/internal-rbac.seed-data.js';

/**
 * Baseline productivo de RBAC interno: roles del sistema, permisos y la matriz rol→permiso.
 *
 * Este seeder es de PERFIL PRODUCTION y NO crea ninguna persona, credencial ni usuario
 * administrador con contraseña versionada. Es la mitad "de arranque" del antiguo
 * `20260704121000-seed-internal-rbac-and-pablo.ts`, que mezclaba catálogo productivo (roles/
 * permisos) con una cuenta SUPER_ADMIN de desarrollo (`pablo@atlas.internal`). Esa cuenta ahora
 * vive en `development/20260704121500-seed-pablo-admin-user.ts`.
 *
 * Idempotente: usa `ON CONFLICT` por clave natural (`role_code`, `permission_code`, y el par
 * `(role_id, permission_id)`), de modo que `db:seed:prod` puede re-aplicarlo sin duplicar filas.
 * `created_by_internal_user_id` se deja en NULL a propósito: en producción no existe un usuario
 * interno "sembrador" y la FK es `ON DELETE SET NULL`.
 */

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

type QueryParams = {
  sql: string;
  replacements?: Record<string, unknown>;
  transaction: Transaction;
};

async function runQuery(queryInterface: QueryInterface, input: QueryParams): Promise<void> {
  await queryInterface.sequelize.query(input.sql, { replacements: input.replacements, transaction: input.transaction });
}

async function upsertRoles(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const role of INTERNAL_ROLE_SEEDS) {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO internal_roles (role_code, role_name, description, department, legacy_role_code, is_system_role, status, _created_at, _updated_at, _deleted)
        VALUES (:roleCode, :roleName, :description, :department, :legacyRoleCode, :isSystemRole, 'active', :createdAt, :createdAt, false)
        ON CONFLICT (role_code) WHERE _deleted = false
        DO UPDATE SET
          role_name = EXCLUDED.role_name,
          description = EXCLUDED.description,
          department = EXCLUDED.department,
          legacy_role_code = EXCLUDED.legacy_role_code,
          is_system_role = EXCLUDED.is_system_role,
          status = 'active',
          _updated_at = EXCLUDED._updated_at;
      `,
      replacements: {
        roleCode: role.code,
        roleName: role.name,
        description: role.description,
        department: role.department,
        legacyRoleCode: role.legacyRoleCode,
        isSystemRole: role.isSystemRole,
        createdAt: CREATED_AT,
      },
    });
  }
}

async function upsertPermissions(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const permission of INTERNAL_PERMISSION_SEEDS) {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO internal_permissions (
          permission_code, module_code, resource_code, action_code, description, risk_level,
          requires_reason, requires_mfa, is_system_permission, status, _created_at, _updated_at, _deleted
        )
        VALUES (
          :permissionCode, :moduleCode, :resourceCode, :actionCode, :description, :riskLevel,
          :requiresReason, false, true, 'active', :createdAt, :createdAt, false
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
          _updated_at = EXCLUDED._updated_at;
      `,
      replacements: {
        permissionCode: permission.code,
        moduleCode: permission.module,
        resourceCode: permission.resource,
        actionCode: permission.action,
        description: permission.description,
        riskLevel: permission.riskLevel,
        requiresReason: permission.requiresReason,
        createdAt: CREATED_AT,
      },
    });
  }
}

async function assignRolePermissions(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSION_CODES)) {
    for (const permissionCode of permissionCodes) {
      await runQuery(queryInterface, {
        transaction,
        sql: `
          INSERT INTO internal_role_permissions (role_id, permission_id, created_by_internal_user_id, _created_at)
          SELECT r._id, p._id, NULL, :createdAt
          FROM internal_roles r
          JOIN internal_permissions p ON p.permission_code = :permissionCode AND p._deleted = false
          WHERE r.role_code = :roleCode AND r._deleted = false
          ON CONFLICT (role_id, permission_id) DO NOTHING;
        `,
        replacements: { roleCode, permissionCode, createdAt: CREATED_AT },
      });
    }
  }
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await upsertRoles(queryInterface, transaction);
    await upsertPermissions(queryInterface, transaction);
    await assignRolePermissions(queryInterface, transaction);
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // internal_user_roles referencia internal_roles con ON DELETE RESTRICT: hay que soltar cualquier
    // asignación de usuario a roles del sistema antes de poder borrar los roles. En producción esto
    // es no-op (no hay usuarios internos sembrados).
    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM internal_user_roles WHERE role_id IN (SELECT _id FROM internal_roles WHERE is_system_role = true);`,
    });
    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM internal_role_permissions WHERE role_id IN (SELECT _id FROM internal_roles WHERE is_system_role = true);`,
    });
    await runQuery(queryInterface, { transaction, sql: `DELETE FROM internal_permissions WHERE is_system_permission = true;` });
    await runQuery(queryInterface, { transaction, sql: `DELETE FROM internal_roles WHERE is_system_role = true;` });
  });
}
