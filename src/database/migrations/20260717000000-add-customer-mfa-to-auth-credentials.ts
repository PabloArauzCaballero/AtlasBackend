import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

/**
 * Fase 4.2 del plan 10/10 — MFA/OTP opt-in para clientes.
 *
 * Añade `mfa_enabled` a `auth_credentials` (la credencial de login de todos los actores). Con este
 * flag activo, el login del cliente exige un segundo factor (OTP de un solo uso por correo),
 * reutilizando el mismo flujo de PIN que ya usan los actores internos. Default `false`: el
 * comportamiento previo (login de un paso) se conserva para todos los clientes existentes.
 */
const TABLE = 'auth_credentials';
const COLUMN = 'mfa_enabled';

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const table = await queryInterface.describeTable(TABLE);
  if (!(COLUMN in table)) {
    await queryInterface.addColumn(TABLE, COLUMN, {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    } as never);
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const table = await queryInterface.describeTable(TABLE);
  if (COLUMN in table) {
    await queryInterface.removeColumn(TABLE, COLUMN);
  }
}
