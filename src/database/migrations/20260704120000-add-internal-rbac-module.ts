import { QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

const INTERNAL_USER_COLUMNS: readonly string[] = [
  `ADD COLUMN IF NOT EXISTS department VARCHAR(40)`,
  `ADD COLUMN IF NOT EXISTS job_title VARCHAR(120)`,
  `ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE`,
  `ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE`,
  `ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
  `ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false`,
  `ADD COLUMN IF NOT EXISTS created_by_internal_user_id BIGINT`,
  `ADD COLUMN IF NOT EXISTS updated_by_internal_user_id BIGINT`,
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE internal_users
      ${INTERNAL_USER_COLUMNS.join(',\n      ')};
  `);

  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS internal_roles (
      _id BIGSERIAL PRIMARY KEY,
      role_code VARCHAR(80) NOT NULL,
      role_name VARCHAR(140) NOT NULL,
      description TEXT,
      department VARCHAR(40),
      legacy_role_code VARCHAR(80) NOT NULL,
      is_system_role BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE,
      _deleted BOOLEAN NOT NULL DEFAULT false
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS internal_permissions (
      _id BIGSERIAL PRIMARY KEY,
      permission_code VARCHAR(140) NOT NULL,
      module_code VARCHAR(80) NOT NULL,
      resource_code VARCHAR(100) NOT NULL,
      action_code VARCHAR(80) NOT NULL,
      description TEXT,
      risk_level VARCHAR(40) NOT NULL DEFAULT 'MEDIUM',
      requires_reason BOOLEAN NOT NULL DEFAULT false,
      requires_mfa BOOLEAN NOT NULL DEFAULT false,
      is_system_permission BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE,
      _deleted BOOLEAN NOT NULL DEFAULT false
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS internal_role_permissions (
      _id BIGSERIAL PRIMARY KEY,
      role_id BIGINT NOT NULL REFERENCES internal_roles(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      permission_id BIGINT NOT NULL REFERENCES internal_permissions(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      created_by_internal_user_id BIGINT REFERENCES internal_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS internal_user_roles (
      _id BIGSERIAL PRIMARY KEY,
      _tenant_id BIGINT NOT NULL REFERENCES tenants(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      internal_user_id BIGINT NOT NULL REFERENCES internal_users(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      role_id BIGINT NOT NULL REFERENCES internal_roles(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      assigned_by_internal_user_id BIGINT REFERENCES internal_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMP WITH TIME ZONE,
      revoked_by_internal_user_id BIGINT REFERENCES internal_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      revocation_reason TEXT,
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_roles_code ON internal_roles(role_code) WHERE _deleted = false;`,
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_permissions_code ON internal_permissions(permission_code) WHERE _deleted = false;`,
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_role_permissions_pair ON internal_role_permissions(role_id, permission_id);`,
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_user_roles_active ON internal_user_roles(_tenant_id, internal_user_id, role_id) WHERE revoked_at IS NULL;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_internal_user_roles_user ON internal_user_roles(_tenant_id, internal_user_id) WHERE revoked_at IS NULL;`,
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_internal_users_tenant_email_active ON internal_users(_tenant_id, lower(email)) WHERE _deleted = false AND email IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_internal_users_tenant_email_active;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_internal_user_roles_user;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_internal_user_roles_active;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_internal_role_permissions_pair;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_internal_permissions_code;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_internal_roles_code;');
  await queryInterface.dropTable('internal_user_roles');
  await queryInterface.dropTable('internal_role_permissions');
  await queryInterface.dropTable('internal_permissions');
  await queryInterface.dropTable('internal_roles');

  await queryInterface.sequelize.query(`
    ALTER TABLE internal_users
      DROP COLUMN IF EXISTS updated_by_internal_user_id,
      DROP COLUMN IF EXISTS created_by_internal_user_id,
      DROP COLUMN IF EXISTS mfa_enabled,
      DROP COLUMN IF EXISTS must_change_password,
      DROP COLUMN IF EXISTS password_changed_at,
      DROP COLUMN IF EXISTS last_login_at,
      DROP COLUMN IF EXISTS job_title,
      DROP COLUMN IF EXISTS department;
  `);
}
