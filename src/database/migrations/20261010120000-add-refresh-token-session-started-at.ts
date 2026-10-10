/**
 * @file Migración reversible: el refresh token recuerda cuándo empezó su sesión, para el tope absoluto de la sesión del cliente.
 * @business La sesión del cliente dura como mucho 8 horas desde el último inicio de sesión con contraseña o PIN, aunque la app la renueve sola.
 * @system agrega `iam.auth_refresh_tokens.session_started_at` y la rellena en los tokens vigentes con el `issued_at` de la raíz de su cadena de rotación.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('auth_refresh_tokens');
const TABLA = { tableName: 'auth_refresh_tokens', schema: SCHEMA };
const TOKENS = `"${SCHEMA}".auth_refresh_tokens`;

/**
 * Nulable: el código tolera un token sin dato (toma su propia emisión), así que la columna no necesita un valor por
 * defecto que mintiera sobre cuándo empezó la sesión.
 *
 * El relleno sólo toca tokens VIGENTES (sin revocar y sin vencer): los demás ya no se pueden canjear. Para cada uno,
 * el inicio de su sesión es el `issued_at` de la raíz de su cadena —el token que emitió el login, el que ningún otro
 * reemplazó—, que se alcanza recorriendo `replaced_by_token_id` hacia delante desde cada raíz (por la clave primaria).
 * `c._id > f._id` sólo protege de un ciclo imposible: cada rotación crea un id mayor.
 *
 * Idempotente: sólo escribe donde `session_started_at` sigue nulo, así que volver a correrla no cambia nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  if (!columnas.session_started_at) {
    await queryInterface.addColumn(TABLA, 'session_started_at', { type: DataTypes.DATE, allowNull: true });
  }

  await queryInterface.sequelize.query(`
    WITH RECURSIVE familia AS (
      SELECT raiz._id, raiz.replaced_by_token_id, raiz.issued_at AS inicio
      FROM ${TOKENS} raiz
      WHERE NOT EXISTS (SELECT 1 FROM ${TOKENS} padre WHERE padre.replaced_by_token_id = raiz._id)
      UNION ALL
      SELECT c._id, c.replaced_by_token_id, f.inicio
      FROM ${TOKENS} c
      JOIN familia f ON c._id = f.replaced_by_token_id AND c._id > f._id
    )
    UPDATE ${TOKENS} t
    SET session_started_at = familia.inicio
    FROM familia
    WHERE t._id = familia._id
      AND t.session_started_at IS NULL
      AND t.revoked_at IS NULL
      AND t.expires_at > now();
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  if (columnas.session_started_at) await queryInterface.removeColumn(TABLA, 'session_started_at');
}
