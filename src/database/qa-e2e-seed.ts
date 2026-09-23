/** Identidad sintética usada sólo por el stack efímero de AdminPortal en CI. */
import type { Client } from 'pg';
import { hashPassword, isPasswordStrongEnough } from '../common/utils/crypto/password.util.js';
import { ROLE_PERMISSION_CODES } from '../modules/internal-users/internal-rbac.permissions.js';
import { INTERNAL_ROLE_SEEDS } from '../modules/internal-users/internal-rbac.roles.js';

export const QA_E2E_EMAIL = 'qa-admin-e2e@atlas-qa.example.com';
const DEMO_EMAIL = 'paola.iriarte@atlas.demo';
const QA_USER_ID = 930007;
const QA_TENANT_ID = 1;
const E2E_ROLE_CODES = ['QA_ENGINEER', 'SUPER_ADMIN'] as const;

function canonicalRole(code: (typeof E2E_ROLE_CODES)[number]): (typeof INTERNAL_ROLE_SEEDS)[number] {
  const role = INTERNAL_ROLE_SEEDS.find((candidate) => candidate.code === code);
  if (!role) throw new Error(`Falta ${code} en el catálogo canónico de roles.`);
  return role;
}

/** La suite recorre todas las vistas, incluida administración; sólo existe en el runner desechable. */
async function ensureE2eRoles(client: Client): Promise<string[]> {
  const roleIds: string[] = [];
  for (const code of E2E_ROLE_CODES) {
    const role = canonicalRole(code);
    const expectedPermissions = ROLE_PERMISSION_CODES[code];
    const existing = await client.query<{ _id: string }>(
      `SELECT _id FROM iam.internal_roles WHERE role_code = $1 AND status = 'active' AND _deleted = false`,
      [code],
    );
    let roleId = existing.rows[0]?._id;
    if (!roleId) {
      // Las migraciones sincronizan permisos, pero el cluster vacío no trae roles de la base de
      // semillas externa. Se crean sólo los dos que requiere este actor, desde el catálogo canónico.
      const created = await client.query<{ _id: string }>(
        `INSERT INTO iam.internal_roles
           (role_code, role_name, description, department, legacy_role_code, is_system_role, status, _created_at, _deleted)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), false)
         ON CONFLICT (role_code) WHERE _deleted = false
         DO UPDATE SET status = 'active', _updated_at = now()
         RETURNING _id`,
        [role.code, role.name, role.description, role.department, role.legacyRoleCode, role.isSystemRole],
      );
      roleId = created.rows[0]?._id;
      if (!roleId) throw new Error(`No se pudo crear el rol ${code} sintético.`);
    }

    const permissions = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM iam.internal_permissions
        WHERE permission_code = ANY($1::text[]) AND status = 'active' AND _deleted = false`,
      [expectedPermissions],
    );
    if (Number(permissions.rows[0]?.total) !== expectedPermissions.length) {
      throw new Error(`El catálogo de permisos ${code} está incompleto tras las migraciones.`);
    }
    await client.query(
      `INSERT INTO iam.internal_role_permissions (role_id, permission_id, _created_at)
       SELECT $1, _id, now() FROM iam.internal_permissions WHERE permission_code = ANY($2::text[])
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, expectedPermissions],
    );
    roleIds.push(roleId);
  }
  return roleIds;
}

export interface QaSeedTarget {
  NODE_ENV?: string | undefined;
  ALLOW_E2E_SEED?: string | undefined;
  DB_HOST?: string | undefined;
  DB_NAME?: string | undefined;
}

/** La guarda se ejecuta también dentro de cada operación, antes de la primera consulta. */
export function assertQaSeedTarget(target: QaSeedTarget): void {
  if (
    target.NODE_ENV !== 'development' ||
    target.ALLOW_E2E_SEED !== 'true' ||
    !['localhost', '127.0.0.1'].includes(target.DB_HOST ?? '') ||
    target.DB_NAME !== 'atlas_e2e_admin'
  ) {
    throw new Error('El seed E2E sólo acepta la base local atlas_e2e_admin con NODE_ENV=development y ALLOW_E2E_SEED=true.');
  }
}

export async function seedQaIdentity(client: Client, password: string, target: QaSeedTarget): Promise<void> {
  assertQaSeedTarget(target);
  if (!isPasswordStrongEnough(password) || password.length < 20) {
    throw new Error('La contraseña E2E generada por el runner debe tener al menos 20 caracteres y cumplir la política de complejidad.');
  }
  const passwordHash = await hashPassword(password);

  await client.query('BEGIN');
  try {
    const roleIds = await ensureE2eRoles(client);

    const user = await client.query(
      `UPDATE iam.internal_users
          SET email = $1, full_name = 'QA E2E (sintético)', role_code = 'admin',
              status = 'active', mfa_enabled = true, must_change_password = false, _updated_at = now()
        WHERE _id = $2 AND _tenant_id = $3 AND _deleted = false`,
      [QA_E2E_EMAIL, QA_USER_ID, QA_TENANT_ID],
    );
    if (user.rowCount !== 1) throw new Error('Falta el actor QA sintético 930007; ejecute primero db:seed:demo.');

    await client.query(
      `INSERT INTO iam.auth_credentials (_tenant_id, actor_type, actor_id, password_hash, mfa_enabled, _created_at)
       VALUES ($2, 'internal_user', $3, $1, true, now())
       ON CONFLICT (actor_type, actor_id) WHERE _deleted = false
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     token_version = iam.auth_credentials.token_version + 1,
                     failed_login_attempts = 0, locked_until = NULL,
                     mfa_enabled = true, _updated_at = now()`,
      [passwordHash, QA_TENANT_ID, QA_USER_ID],
    );
    for (const roleId of roleIds) {
      await client.query(
        `INSERT INTO iam.internal_user_roles (_tenant_id, internal_user_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (_tenant_id, internal_user_id, role_id) WHERE revoked_at IS NULL DO NOTHING`,
        [QA_TENANT_ID, QA_USER_ID, roleId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function resetQaIdentity(client: Client, target: QaSeedTarget): Promise<void> {
  assertQaSeedTarget(target);
  await client.query('BEGIN');
  try {
    await client.query(
      `DELETE FROM iam.auth_credentials
        WHERE actor_type = 'internal_user' AND actor_id = $1 AND _tenant_id = $2
          AND EXISTS (SELECT 1 FROM iam.internal_users WHERE _id = $1 AND _tenant_id = $2 AND email = $3)`,
      [QA_USER_ID, QA_TENANT_ID, QA_E2E_EMAIL],
    );
    await client.query(
      `DELETE FROM iam.internal_user_roles
        WHERE internal_user_id = $1 AND _tenant_id = $2
          AND role_id IN (SELECT _id FROM iam.internal_roles WHERE role_code = ANY($4::text[]))
          AND EXISTS (SELECT 1 FROM iam.internal_users WHERE _id = $1 AND _tenant_id = $2 AND email = $3)`,
      [QA_USER_ID, QA_TENANT_ID, QA_E2E_EMAIL, E2E_ROLE_CODES],
    );
    const restored = await client.query(
      `UPDATE iam.internal_users
          SET email = $1, full_name = 'Paola Iriarte Lima', role_code = 'qa_engineer', _updated_at = now()
        WHERE _id = $2 AND _tenant_id = $3 AND email = $4`,
      [DEMO_EMAIL, QA_USER_ID, QA_TENANT_ID, QA_E2E_EMAIL],
    );
    if (restored.rowCount !== 1) throw new Error('La identidad QA E2E no existe; no se modificó ningún otro actor.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
