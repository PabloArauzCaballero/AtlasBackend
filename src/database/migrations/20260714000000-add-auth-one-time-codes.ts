import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

/**
 * Códigos de un solo uso del módulo auth, entregados por correo vía MailSender:
 * - `purpose = 'password_reset'`: código de 6 dígitos para el flujo "olvidé mi contraseña".
 * - `purpose = 'login_pin'`: PIN de 6 dígitos exigido a super admins (roles admin/platform_admin)
 *   como segundo paso del login. `challenge_hash` guarda el hash del token opaco de desafío que
 *   el cliente recibe tras validar la contraseña: verificar el PIN exige presentar ese token, no
 *   solo adivinar 6 dígitos conociendo el email.
 *
 * Igual que `auth_refresh_tokens`, nunca se persiste el código/token en claro: solo SHA-256.
 * `attempts` + `consumed_at` implementan límite de intentos y un-solo-uso a nivel de fila.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable('auth_one_time_codes', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
    actor_type: { type: DataTypes.STRING(40), allowNull: false },
    actor_id: { type: DataTypes.BIGINT, allowNull: false },
    purpose: { type: DataTypes.STRING(40), allowNull: false },
    code_hash: { type: DataTypes.STRING(128), allowNull: false },
    challenge_hash: { type: DataTypes.STRING(128), allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    consumed_at: { type: DataTypes.DATE, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await queryInterface.addIndex('auth_one_time_codes', ['actor_type', 'actor_id', 'purpose', 'consumed_at'], {
    name: 'ix_auth_one_time_codes_actor_purpose',
  });

  // Índice único parcial vía SQL crudo, mismo patrón que `ux_customers_tenant_email_hash`
  // (queryInterface.addIndex no soporta de forma portable `WHERE ... IS NOT NULL`).
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_auth_one_time_codes_challenge" ON "auth_one_time_codes" ("challenge_hash") WHERE challenge_hash IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ux_auth_one_time_codes_challenge";');
  await queryInterface.dropTable('auth_one_time_codes');
}
