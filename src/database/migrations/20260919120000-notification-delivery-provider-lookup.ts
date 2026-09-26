/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite saber en milisegundos a qué envío se refiere el aviso de un proveedor.
 * @system índice por (provider, provider_message_id) en `notification_deliveries`. Sólo índice: no
 *   toca ni una fila, así que es segura de aplicar sobre una base con datos.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('notification_deliveries');
const DELIVERIES = `${SCHEMA}.notification_deliveries`;

/**
 * Por qué hace falta.
 *
 * Los callbacks de Twilio (estado del SMS) y de SendGrid (entregado, rebote) llegan identificando el
 * envío SÓLO por el identificador del proveedor. Los índices que ya existían son por mensaje y por
 * `(channel, provider, status)`: ninguno sirve para esa búsqueda, que acabaría recorriendo la tabla
 * entera. Y no es una consulta ocasional: una campaña genera un callback por mensaje enviado, de
 * modo que el coste crece justo cuando más filas tiene la tabla.
 *
 * Parcial —sólo las filas que TIENEN identificador de proveedor— porque las entregas `in_app` y las
 * que fallaron antes de salir lo dejan en NULL y nunca se buscan por él.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_notification_deliveries_provider_message
       ON ${DELIVERIES} (provider, provider_message_id)
       WHERE provider_message_id IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // El índice vive en el esquema de la tabla: sin calificarlo, el DROP depende del `search_path`.
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${SCHEMA}.ix_notification_deliveries_provider_message;`);
}
