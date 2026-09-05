/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Saber hasta dónde leyó cada parte: los no leídos del cliente y el «visto» del agente.
 * @system dos columnas en `support_channel_participants`; ninguna tabla nueva y ningún contador aparte.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PARTICIPANTS = `${atlasSchemaFor('support_channel_participants')}.support_channel_participants`;

/**
 * El «visto» de la conversación, con dos columnas y sin tabla nueva.
 *
 * ## Por qué un puntero y no un acuse por mensaje
 *
 * Una tabla `mensaje × participante` crece con el producto de dos cosas que crecen, y para
 * responder «¿cuántos sin leer tengo?» habría que contar filas en cada refresco. Con
 * `last_read_sequence` la respuesta es una resta: `last_message_sequence - last_read_sequence`.
 * Y como la lectura sólo avanza —nunca retrocede—, un mensaje leído no puede volver a figurar sin
 * leer porque llegó un ack fuera de orden.
 *
 * ## Por qué NO hay estado «entregado»
 *
 * Porque no tenemos un acuse del dispositivo. WhatsApp puede pintar el doble tic gris porque su
 * cliente confirma la recepción; aquí sólo sabemos que el mensaje quedó escrito en el servidor.
 * Inventar un «entregado» a partir de eso sería decirle al agente que el cliente lo recibió cuando
 * lo único cierto es que nosotros lo guardamos. Dos estados honestos —enviado y leído— valen más
 * que tres, uno de ellos falso.
 *
 * ## Por qué vive en el participante y no en el canal
 *
 * Porque cada parte lee a su ritmo: el cliente puede estar al día y el agente no, o al revés. En el
 * canal sólo cabría un puntero, y sería el de nadie.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${PARTICIPANTS}
  ADD COLUMN IF NOT EXISTS last_read_sequence BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`);

  // La consulta de «mis conversaciones con algo sin leer»: por actor, entre los que siguen dentro.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_participants__sin_leer
       ON ${PARTICIPANTS} (_tenant_id, actor_type, actor_id, last_read_sequence)
       WHERE left_at IS NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${atlasSchemaFor('support_channel_participants')}.idx_support_participants__sin_leer;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${PARTICIPANTS}
  DROP COLUMN IF EXISTS last_read_sequence,
  DROP COLUMN IF EXISTS last_read_at,
  DROP COLUMN IF EXISTS last_seen_at;`);
}
