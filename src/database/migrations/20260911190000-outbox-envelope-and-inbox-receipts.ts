/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que un aviso salga una sola vez por consumidor aunque el proceso muera a medias.
 * @system añade al outbox el sobre de evento (identidad global, productor, versión de agregado y de
 *   esquema, testigo de lease) y crea el inbox de recibos por consumidor (AT-022). Expansiva: las
 *   filas existentes siguen siendo legibles y procesables; ninguna columna anterior cambia.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const OUTBOX = `${atlasSchemaFor('outbox_events')}.outbox_events`;
const INBOX = `${atlasSchemaFor('inbox_receipts')}.inbox_receipts`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = queryInterface.sequelize;
  // Identidad global del evento: las filas antiguas la reciben al vuelo (gen_random_uuid es de pgcrypto/PG13+ core).
  await sql.query(`ALTER TABLE ${OUTBOX} ADD COLUMN IF NOT EXISTS event_id UUID NOT NULL DEFAULT gen_random_uuid();`);
  await sql.query(`ALTER TABLE ${OUTBOX} ADD COLUMN IF NOT EXISTS producer VARCHAR(80);`);
  await sql.query(`ALTER TABLE ${OUTBOX} ADD COLUMN IF NOT EXISTS aggregate_version BIGINT;`);
  await sql.query(`ALTER TABLE ${OUTBOX} ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;`);
  await sql.query(`ALTER TABLE ${OUTBOX} ADD COLUMN IF NOT EXISTS owner_token VARCHAR(64);`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_event_id ON ${OUTBOX} (event_id);`);
  await sql.query(
    `CREATE INDEX IF NOT EXISTS ix_outbox_producer_aggregate_version ON ${OUTBOX} (producer, aggregate_type, aggregate_id, aggregate_version);`,
  );

  await sql.query(`CREATE TABLE IF NOT EXISTS ${INBOX} (
    _id BIGSERIAL PRIMARY KEY,
    consumer_id VARCHAR(120) NOT NULL,
    event_id UUID NOT NULL,
    producer VARCHAR(80),
    status VARCHAR(20) NOT NULL DEFAULT 'processed',
    attempts INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    processed_at TIMESTAMPTZ,
    _created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    _updated_at TIMESTAMPTZ
  );`);
  // El recibo es único por consumidor y evento: un segundo procesamiento del mismo evento por el
  // mismo consumidor choca aquí; otro consumidor sí puede recibirlo.
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_inbox_consumer_event ON ${INBOX} (consumer_id, event_id);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS ix_inbox_event ON ${INBOX} (event_id);`);
  // AT-053: si los roles por contexto (ops/postgres/context-roles.sql) ya existen, la tabla recién creada
  // recibe los mismos grants que les dio el guion. Sin esto, un down→up de esta migración dejaba
  // `inbox_receipts` sin permisos para los contextos hasta reejecutar el guion a mano.
  await sql.query(`DO $$
    DECLARE role_name text;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY['atlas_ctx_messaging', 'atlas_ctx_credit', 'atlas_ctx_customer'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ${INBOX} TO %I', role_name);
          EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${atlasSchemaFor('inbox_receipts')} TO %I', role_name);
        END IF;
      END LOOP;
    END $$;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = queryInterface.sequelize;
  // Estructural. Los recibos se pierden: un consumidor podría reprocesar un evento ya visto, que es
  // exactamente por lo que el procesamiento tiene que ser idempotente (AT-035).
  await sql.query(`DROP TABLE IF EXISTS ${INBOX};`);
  await sql.query(`DROP INDEX IF EXISTS ${atlasSchemaFor('outbox_events')}.ix_outbox_producer_aggregate_version;`);
  await sql.query(`DROP INDEX IF EXISTS ${atlasSchemaFor('outbox_events')}.ux_outbox_event_id;`);
  for (const column of ['owner_token', 'schema_version', 'aggregate_version', 'producer', 'event_id']) {
    await sql.query(`ALTER TABLE ${OUTBOX} DROP COLUMN IF EXISTS ${column};`);
  }
}
