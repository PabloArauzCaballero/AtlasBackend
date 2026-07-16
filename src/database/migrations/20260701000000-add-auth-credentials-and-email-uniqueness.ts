import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

/**
 * Migración de autenticación y unicidad de email.
 *
 * Crea credenciales y refresh tokens por actor, agrega `token_version` para revocación global
 * y refuerza unicidad de `primary_email_hash` por tenant a nivel de base de datos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // Credenciales genéricas por tipo de actor.
  await queryInterface.createTable('auth_credentials', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
    actor_type: { type: DataTypes.STRING(40), allowNull: false },
    actor_id: { type: DataTypes.BIGINT, allowNull: false },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    failed_login_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    locked_until: { type: DataTypes.DATE, allowNull: true },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
    last_login_ip: { type: DataTypes.STRING(64), allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    _updated_at: { type: DataTypes.DATE, allowNull: true },
    _deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });
  await queryInterface.addIndex('auth_credentials', ['actor_type', 'actor_id'], {
    name: 'ux_auth_credentials_actor',
    unique: true,
    where: { _deleted: false },
  });

  // Refresh tokens con rotación y revocación; se guarda solo el hash del token.
  await queryInterface.createTable('auth_refresh_tokens', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
    actor_type: { type: DataTypes.STRING(40), allowNull: false },
    actor_id: { type: DataTypes.BIGINT, allowNull: false },
    token_hash: { type: DataTypes.STRING(128), allowNull: false },
    issued_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    revoked_reason: { type: DataTypes.STRING(80), allowNull: true },
    replaced_by_token_id: { type: DataTypes.BIGINT, allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await queryInterface.addIndex('auth_refresh_tokens', ['token_hash'], {
    name: 'ux_auth_refresh_tokens_hash',
    unique: true,
  });
  await queryInterface.addIndex('auth_refresh_tokens', ['actor_type', 'actor_id', 'revoked_at'], {
    name: 'ix_auth_refresh_tokens_actor',
  });

  // Sequelize no modela de forma portable el índice parcial requerido; SQL crudo mantiene el
  // contrato de unicidad solo para emails presentes y filas activas.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_customers_tenant_email_hash" ON "customers" ("_tenant_id", "primary_email_hash") WHERE _deleted = false AND primary_email_hash IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ux_customers_tenant_email_hash";');
  await queryInterface.dropTable('auth_refresh_tokens');
  await queryInterface.dropTable('auth_credentials');
}
