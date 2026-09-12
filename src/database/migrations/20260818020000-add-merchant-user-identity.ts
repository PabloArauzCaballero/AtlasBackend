/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { ATLAS_SCHEMAS } from '../domain-schemas.js';

type MigrationContext = {
  context: QueryInterface;
};

const TABLE = { tableName: 'merchant_users', schema: ATLAS_SCHEMAS.IAM };

/**
 * Identidad del usuario del comercio afiliado (población `merchant_user`).
 *
 * Hasta aquí Atlas tenía tres poblaciones autenticables —cliente, usuario interno y usuario de
 * plataforma— y un rol `merchant` en el vocabulario de tokens sin nadie detrás. El resultado
 * práctico: el comercio no podía iniciar sesión en ningún sitio, y el ERP terminaba fabricando su
 * rol `MERCHANT_ADMIN` a partir de `MERCHANT_OPERATIONS`, que es un rol de empleado de Atlas. Es
 * decir, el "portal del comercio" lo operaba personal interno en nombre del comercio, sin que el
 * modelo pudiera distinguir una cosa de la otra.
 *
 * Esta tabla es sólo identidad. La membresía —qué comercio, con qué alcance— se queda en el ERP
 * (`atlas_sales.merchant_users`), que enlaza por `user_id` contra el `_id` de aquí. No se duplica
 * el comercio en esta base: quien manda sobre la relación comercial es el ERP.
 *
 * Credenciales, refresh tokens, bloqueo por intentos fallidos y revocación se reutilizan tal cual
 * de `auth_credentials` / `auth_refresh_tokens`, cuyo `actor_type` ya es texto libre: no hacía
 * falta tocar esas tablas para admitir una cuarta población.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable(TABLE, {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: false },
    user_code: { type: DataTypes.STRING(60), allowNull: true },
    full_name: { type: DataTypes.STRING(180), allowNull: true },
    email: { type: DataTypes.STRING(180), allowNull: false },
    role_code: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'merchant' },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'invited' },
    phone: { type: DataTypes.STRING(40), allowNull: true },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
    password_changed_at: { type: DataTypes.DATE, allowNull: true },
    must_change_password: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    mfa_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_by_internal_user_id: { type: DataTypes.BIGINT, allowNull: true },
    updated_by_internal_user_id: { type: DataTypes.BIGINT, allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    _updated_at: { type: DataTypes.DATE, allowNull: true },
    _deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  // El login busca por correo normalizado. El índice único es PARCIAL sobre `_deleted = false`
  // para que dar de baja una identidad libere su correo, sin permitir dos vivas a la vez.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_merchant_users_tenant_email"
       ON "${ATLAS_SCHEMAS.IAM}"."merchant_users" ("_tenant_id", lower(btrim("email")))
       WHERE _deleted = false;`,
  );

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_merchant_users_status"
       ON "${ATLAS_SCHEMAS.IAM}"."merchant_users" ("_tenant_id", "status");`,
  );

  // El rol y el estado son vocabulario cerrado: sin esto, un UPDATE manual deja una identidad en
  // un estado que el login no contempla y que, según el lado por el que se lea, significa cosas
  // distintas. `merchant` es hoy el único rol admitido a propósito.
  await queryInterface.sequelize.query(
    `ALTER TABLE "${ATLAS_SCHEMAS.IAM}"."merchant_users"
       ADD CONSTRAINT "ck_merchant_users_status"
       CHECK (status IN ('invited', 'active', 'suspended', 'disabled'));`,
  );

  await queryInterface.sequelize.query(
    `ALTER TABLE "${ATLAS_SCHEMAS.IAM}"."merchant_users"
       ADD CONSTRAINT "ck_merchant_users_role_code"
       CHECK (role_code = 'merchant');`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ATLAS_SCHEMAS.IAM}"."ix_merchant_users_status";`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ATLAS_SCHEMAS.IAM}"."ux_merchant_users_tenant_email";`);
  await queryInterface.dropTable(TABLE);
}
