import { QueryInterface, Transaction } from 'sequelize';
import {
  INTERNAL_PERMISSION_SEEDS,
  INTERNAL_ROLE_SEEDS,
  ROLE_PERMISSION_CODES,
} from '../../modules/internal-users/internal-rbac.seed-data.js';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const PABLO_INTERNAL_USER_ID = 1;
const PABLO_TENANT_ID = 1;
const PABLO_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$VDi3tAhiCzEiTK454N7psg$OXSNkeaFiWk4isxmbnnDSPC/Q2w58j/mWKN0bCK/m2w';
const PABLO_ROLE_CODES = ['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'DATA_GOVERNANCE_MANAGER'] as const;

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
          SELECT r._id, p._id, :createdByInternalUserId, :createdAt
          FROM internal_roles r
          JOIN internal_permissions p ON p.permission_code = :permissionCode AND p._deleted = false
          WHERE r.role_code = :roleCode AND r._deleted = false
          ON CONFLICT (role_id, permission_id) DO NOTHING;
        `,
        replacements: {
          roleCode,
          permissionCode,
          createdByInternalUserId: PABLO_INTERNAL_USER_ID,
          createdAt: CREATED_AT,
        },
      });
    }
  }
}

async function upsertPabloInternalUser(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO internal_users (
        _id, _tenant_id, user_code, full_name, email, role_code, status, department, job_title,
        last_login_at, password_changed_at, must_change_password, mfa_enabled,
        created_by_internal_user_id, updated_by_internal_user_id, _created_at, _updated_at, _deleted
      )
      VALUES (
        :id, :tenantId, 'pablo.admin', 'Pablo Arauz Caballero', 'pablo@atlas.internal', 'admin', 'active', 'SYSTEMS',
        'Founder / Systems Administrator', NULL, :createdAt, false, false, NULL, NULL, :createdAt, :createdAt, false
      )
      ON CONFLICT (_id)
      DO UPDATE SET
        _tenant_id = EXCLUDED._tenant_id,
        user_code = EXCLUDED.user_code,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        role_code = EXCLUDED.role_code,
        status = EXCLUDED.status,
        department = EXCLUDED.department,
        job_title = EXCLUDED.job_title,
        password_changed_at = EXCLUDED.password_changed_at,
        must_change_password = EXCLUDED.must_change_password,
        mfa_enabled = EXCLUDED.mfa_enabled,
        _updated_at = EXCLUDED._updated_at,
        _deleted = false;
    `,
    replacements: { id: PABLO_INTERNAL_USER_ID, tenantId: PABLO_TENANT_ID, createdAt: CREATED_AT },
  });

  await runQuery(queryInterface, {
    transaction,
    sql: `
      SELECT setval(
        pg_get_serial_sequence('internal_users', '_id'),
        COALESCE((SELECT MAX(_id) FROM internal_users), 1),
        true
      )
      WHERE pg_get_serial_sequence('internal_users', '_id') IS NOT NULL;
    `,
  });
}

async function upsertPabloCredentials(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      UPDATE auth_credentials
      SET password_hash = :passwordHash,
          token_version = token_version + 1,
          failed_login_attempts = 0,
          locked_until = NULL,
          _updated_at = :createdAt,
          _deleted = false
      WHERE actor_type = 'internal_user' AND actor_id = :actorId;
    `,
    replacements: { passwordHash: PABLO_PASSWORD_HASH, actorId: PABLO_INTERNAL_USER_ID, createdAt: CREATED_AT },
  });

  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO auth_credentials (
        _tenant_id, actor_type, actor_id, password_hash, token_version, failed_login_attempts,
        locked_until, last_login_at, last_login_ip, _created_at, _updated_at, _deleted
      )
      SELECT :tenantId, 'internal_user', :actorId, :passwordHash, 1, 0, NULL, NULL, NULL, :createdAt, :createdAt, false
      WHERE NOT EXISTS (
        SELECT 1 FROM auth_credentials WHERE actor_type = 'internal_user' AND actor_id = :actorId AND _deleted = false
      );
    `,
    replacements: {
      tenantId: PABLO_TENANT_ID,
      actorId: PABLO_INTERNAL_USER_ID,
      passwordHash: PABLO_PASSWORD_HASH,
      createdAt: CREATED_AT,
    },
  });
}

async function assignPabloRoles(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const roleCode of PABLO_ROLE_CODES) {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO internal_user_roles (
          _tenant_id, internal_user_id, role_id, assigned_by_internal_user_id, assigned_at,
          revoked_at, revoked_by_internal_user_id, revocation_reason, _created_at, _updated_at
        )
        SELECT :tenantId, :internalUserId, r._id, NULL, :createdAt, NULL, NULL, NULL, :createdAt, :createdAt
        FROM internal_roles r
        WHERE r.role_code = :roleCode AND r._deleted = false
          AND NOT EXISTS (
            SELECT 1
            FROM internal_user_roles ur
            WHERE ur._tenant_id = :tenantId
              AND ur.internal_user_id = :internalUserId
              AND ur.role_id = r._id
              AND ur.revoked_at IS NULL
          );
      `,
      replacements: { tenantId: PABLO_TENANT_ID, internalUserId: PABLO_INTERNAL_USER_ID, roleCode, createdAt: CREATED_AT },
    });
  }
}

async function createSeedAudit(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO operational_audit_logs (
        _tenant_id, actor_type, actor_internal_user_id, actor_platform_user_id, action_code,
        target_type, target_id, ip_address, user_agent, payload_json, occurred_at, _created_at
      )
      VALUES (
        :tenantId, 'system', NULL, NULL, 'seed.internal_rbac_and_pablo.applied',
        'database_seed', '20260704121000-seed-internal-rbac-and-pablo', '127.0.0.1', 'Atlas Seeder',
        CAST(:payload AS jsonb), :createdAt, :createdAt
      );
    `,
    replacements: {
      tenantId: PABLO_TENANT_ID,
      payload: JSON.stringify({
        pabloEmail: 'pablo@atlas.internal',
        roles: PABLO_ROLE_CODES,
        note: 'Credenciales de desarrollo para login interno del frontend administrativo.',
      }),
      createdAt: CREATED_AT,
    },
  });
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await upsertRoles(queryInterface, transaction);
    await upsertPermissions(queryInterface, transaction);
    await upsertPabloInternalUser(queryInterface, transaction);
    await upsertPabloCredentials(queryInterface, transaction);
    await assignRolePermissions(queryInterface, transaction);
    await assignPabloRoles(queryInterface, transaction);
    await createSeedAudit(queryInterface, transaction);
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        UPDATE internal_user_roles
        SET revoked_at = :revokedAt,
            revoked_by_internal_user_id = NULL,
            revocation_reason = 'seed_down'
        WHERE _tenant_id = :tenantId AND internal_user_id = :internalUserId AND revoked_at IS NULL;
      `,
      replacements: { tenantId: PABLO_TENANT_ID, internalUserId: PABLO_INTERNAL_USER_ID, revokedAt: new Date() },
    });

    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM internal_role_permissions WHERE role_id IN (SELECT _id FROM internal_roles WHERE is_system_role = true);`,
    });
    await runQuery(queryInterface, { transaction, sql: `DELETE FROM internal_permissions WHERE is_system_permission = true;` });
    await runQuery(queryInterface, { transaction, sql: `DELETE FROM internal_roles WHERE is_system_role = true;` });
  });
}
