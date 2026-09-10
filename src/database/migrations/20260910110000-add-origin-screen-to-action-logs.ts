/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite saber desde qué pantalla se originó cada acción registrada.
 * @system añade `origin_screen` a `system_action_logs` y el eje de verificación al catálogo de pantallas.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const LOGS = `${atlasSchemaFor('system_action_logs')}.system_action_logs`;
const SCREENS = `${atlasSchemaFor('system_screen_catalog')}.system_screen_catalog`;

/**
 * Flujos, ola 9: verificar también las PANTALLAS.
 *
 * Hasta ahora Flujos verificaba endpoints contra corridas reales y las 267 pantallas del catálogo
 * no tenían eje de verificación en absoluto: se sabía que existían en el código y nada más. La
 * arista pantalla→endpoint se derivaba del AST, así que decía lo que el código PARECE hacer, no lo
 * que de verdad ocurre cuando alguien la abre.
 *
 * `origin_screen` guarda la ruta de la pantalla que originó la petición, que el portal declara en
 * `x-atlas-flow`. Con eso, una pantalla pasa a VERIFIED cuando alguien la usó de verdad, y las
 * llamadas observadas se pueden contrastar con las declaradas.
 *
 * ## Por qué una columna y no una tabla aparte
 *
 * Porque la fila ya existe: `system_action_logs` escribe una por request con método, ruta, estado y
 * `correlation_id`. Una tabla nueva obligaría a unir por `request_id` para responder «¿desde dónde
 * se llamó a esto?», que es la única pregunta que esta columna existe para contestar.
 *
 * ## Por qué NULL es lo normal y no un defecto
 *
 * La mayoría del tráfico no viene de una pantalla: la app móvil, los webhooks, los trabajos de
 * fondo y las suites de prueba no tienen origen que declarar. Un NULL aquí significa «nadie dijo de
 * dónde venía», que es distinto de «vino de ninguna parte», y por eso no lleva default.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${LOGS}
  ADD COLUMN IF NOT EXISTS origin_screen VARCHAR(200);
`);
  // Índice parcial: la inmensa mayoría de las filas tiene NULL y no hace falta indexarlas. La
  // consulta que lo usa agrupa por pantalla dentro de una ventana, así que la fecha va en la clave.
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_action_logs_origin_screen
  ON ${LOGS} (origin_screen, occurred_at DESC)
  WHERE origin_screen IS NOT NULL;
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${SCREENS}
  ADD COLUMN IF NOT EXISTS verification    VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS verified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observed_json   JSONB NOT NULL DEFAULT '{}'::jsonb;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${atlasSchemaFor('system_action_logs')}.ix_action_logs_origin_screen;`);
  await queryInterface.sequelize.query(`ALTER TABLE ${LOGS} DROP COLUMN IF EXISTS origin_screen;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${SCREENS}
  DROP COLUMN IF EXISTS verification,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS last_seen_at,
  DROP COLUMN IF EXISTS observed_json;
`);
}
