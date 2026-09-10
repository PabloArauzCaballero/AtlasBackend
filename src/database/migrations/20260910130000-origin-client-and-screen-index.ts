/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza evita atribuir el uso de una pantalla al portal equivocado.
 * @system añade el cliente de origen y rehace el índice para que pueda podar por ventana.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const LOGS = `${atlasSchemaFor('system_action_logs')}.system_action_logs`;
const ESQUEMA = atlasSchemaFor('system_action_logs');

/**
 * Dos correcciones sobre el eje de pantallas, ambas de la misma revisión.
 *
 * ## `origin_client`: la ruta sola no dice de qué portal viene
 *
 * `/` existe como pantalla en los CINCO clientes del catálogo, y `/login` en tres. Cruzando sólo por
 * ruta, en cuanto un segundo portal empiece a declarar su origen —que es el plan— una visita a `/`
 * marcaría VERIFIED las cinco, y copiaría en las cinco las llamadas del único que se usó. El portal
 * ya manda `x-atlas-product`; lo que faltaba era guardarlo junto al origen y cruzar por los dos.
 *
 * ## El índice: `origin_screen` no puede ir de primera
 *
 * La consulta agrupa por pantalla dentro de una ventana, y sobre `origin_screen` sólo tiene un
 * `IS NOT NULL`: sin predicado de igualdad en la columna líder, PostgreSQL recorre el índice parcial
 * ENTERO y usa la fecha como filtro. Es decir, el coste de cada verificación crecía con el histórico
 * completo en vez de con la ventana. Con `occurred_at` de primera sí poda.
 *
 * Y se crea CONCURRENTLY: `system_action_logs` recibe una fila por request, y un `CREATE INDEX`
 * normal toma el bloqueo que detiene todos los INSERT mientras escanea la tabla. Por eso esta
 * migración no puede ir dentro de una transacción.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${LOGS}
  ADD COLUMN IF NOT EXISTS origin_client VARCHAR(60);
`);
  await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ESQUEMA}.ix_action_logs_origin_screen;`);
  await queryInterface.sequelize.query(`
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_action_logs_origin_screen
  ON ${LOGS} (occurred_at DESC)
  INCLUDE (origin_screen, origin_client, method, route_template, response_status_code)
  WHERE origin_screen IS NOT NULL;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ESQUEMA}.ix_action_logs_origin_screen;`);
  await queryInterface.sequelize.query(`ALTER TABLE ${LOGS} DROP COLUMN IF EXISTS origin_client;`);
  await queryInterface.sequelize.query(`
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_action_logs_origin_screen
  ON ${LOGS} (origin_screen, occurred_at DESC)
  WHERE origin_screen IS NOT NULL;
`);
}
