import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

/**
 * Patch Fase 1 — Auth real + cierre de condición de carrera en alta de cliente.
 *
 * Referencias de auditoría cerradas por esta migración:
 * - ATLAS-AUDIT-002: no existía módulo de autenticación ni tabla de credenciales/refresh tokens.
 * - ATLAS-AUDIT-021: `primary_email_hash` de `customers` no tenía restricción única a nivel de
 *   base de datos (solo `primary_phone_hash` la tenía), permitiendo clientes duplicados bajo
 *   condición de carrera cuando dos registros concurrentes comparten el mismo email.
 * - ATLAS-AUDIT-026: se agrega `token_version` en `auth_credentials` para que la revocación de
 *   tokens (comparada en `JwtAuthGuard` vía `TokenRevocationService`) sea real, no solo un campo
 *   decorativo en el tipo `AuthenticatedUser`.
 *
 * No se modifica la migración monolítica original (`20260626154044-...`) porque ya fue aplicada:
 * `CONTRIBUTING.md` prohíbe editar migraciones ya aplicadas en ambientes compartidos. Este patch
 * sigue el patrón correcto: migraciones nuevas, pequeñas y focalizadas por dominio.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // 1. Credenciales de autenticación, genéricas por tipo de actor (customer / internal_user / platform_user).
  //    Se modela aparte de las tablas de actor existentes para no tocar la migración monolítica ya aplicada.
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

  // 2. Refresh tokens con rotación y revocación (BACKEND_DEVELOPMENT_CONTEXT.md §10).
  //    Se guarda el hash del token, nunca el token en claro (defensa en profundidad ante fuga de DB).
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

  // 3. Cierre de ATLAS-AUDIT-021: restricción única real para email, con el mismo patrón SQL crudo
  //    ya usado por la migración base para índices parciales (ver `createIndexes()` en
  //    `20260626154044-...ts`), que ya aplica correctamente esta misma estrategia a
  //    `primary_phone_hash`. `queryInterface.addIndex` no soporta de forma portable expresiones
  //    `WHERE ... IS NOT NULL`, por eso se usa SQL crudo igual que en el resto del proyecto.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_customers_tenant_email_hash" ON "customers" ("_tenant_id", "primary_email_hash") WHERE _deleted = false AND primary_email_hash IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ux_customers_tenant_email_hash";');
  await queryInterface.dropTable('auth_refresh_tokens');
  await queryInterface.dropTable('auth_credentials');
}
