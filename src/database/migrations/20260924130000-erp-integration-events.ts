/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Core y el ERP se avisan hechos de dinero (pago confirmado, cobertura liquidada) una sola
 *   vez aunque la red los repita, y lo que el ERP cubrió queda consultable en Core (P-14 · B20).
 * @system crea la inbox de eventos EXTERNOS con su última versión por agregado, la cola de entregas
 *   salientes firmadas hacia el ERP y la proyección de cobertura por cuota.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const INBOX = `${atlasSchemaFor('external_event_inbox')}.external_event_inbox`;
const VERSIONS = `${atlasSchemaFor('external_aggregate_versions')}.external_aggregate_versions`;
const DELIVERIES = `${atlasSchemaFor('outbound_event_deliveries')}.outbound_event_deliveries`;
const PROJECTION = `${atlasSchemaFor('installment_coverage_projections')}.installment_coverage_projections`;

/**
 * Por qué cuatro tablas y no reutilizar `inbox_receipts`.
 *
 * `inbox_receipts` identifica el evento por el `event_id` UUID del outbox de ESTE proceso; la clave
 * del ERP es otra (`coverage-settled-<uuid>`) y viene de fuera. La inbox externa guarda
 * (productor, clave) con unicidad y el desenlace —APPLIED, IGNORED, STALE, UNLINKED—, que es lo que
 * responde «¿esto ya llegó y qué se hizo con ello?». La última versión por agregado va aparte para
 * que una versión vieja reentregada no revierta la proyección.
 *
 * La cola de entregas salientes es una fila por (destino, evento del outbox), escrita en la MISMA
 * transacción que el evento: el aviso de pago y su entrega al ERP nacen juntos o no nacen. Es
 * independiente del estado `processed` del outbox, que pertenece a las notificaciones, y guarda el
 * SOBRE ya construido: la purga del outbox procesado no puede dejar una entrega sin contenido.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = queryInterface.sequelize;
  await sql.query(`CREATE TABLE IF NOT EXISTS ${INBOX} (
    _id               BIGSERIAL PRIMARY KEY,
    producer          VARCHAR(40)  NOT NULL,
    event_key         VARCHAR(200) NOT NULL,
    topic             VARCHAR(120) NOT NULL,
    schema_version    INTEGER      NOT NULL,
    aggregate_type    VARCHAR(80)  NOT NULL,
    aggregate_id      VARCHAR(120) NOT NULL,
    aggregate_version BIGINT       NOT NULL CHECK (aggregate_version >= 1),
    outcome           VARCHAR(20)  NOT NULL CHECK (outcome IN ('APPLIED','IGNORED','STALE','UNLINKED')),
    _tenant_id        BIGINT,
    payload           JSONB        NOT NULL,
    occurred_at       TIMESTAMPTZ  NOT NULL,
    received_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
  );`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_external_event_inbox_key ON ${INBOX} (producer, event_key);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS ix_external_event_inbox_unlinked ON ${INBOX} (received_at) WHERE outcome = 'UNLINKED';`);

  await sql.query(`CREATE TABLE IF NOT EXISTS ${VERSIONS} (
    producer        VARCHAR(40)  NOT NULL,
    aggregate_type  VARCHAR(80)  NOT NULL,
    aggregate_id    VARCHAR(120) NOT NULL,
    last_version    BIGINT       NOT NULL CHECK (last_version >= 1),
    _updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (producer, aggregate_type, aggregate_id)
  );`);

  await sql.query(`CREATE TABLE IF NOT EXISTS ${DELIVERIES} (
    _id               BIGSERIAL PRIMARY KEY,
    _tenant_id        BIGINT       NOT NULL,
    destination       VARCHAR(40)  NOT NULL,
    event_id          UUID         NOT NULL,
    event_code        VARCHAR(120) NOT NULL,
    aggregate_type    VARCHAR(80)  NOT NULL,
    aggregate_id      VARCHAR(120) NOT NULL,
    aggregate_version BIGINT       NOT NULL CHECK (aggregate_version >= 1),
    envelope          JSONB        NOT NULL,
    status            VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead')),
    attempts          INTEGER      NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    lease_owner       VARCHAR(80),
    lease_expires_at  TIMESTAMPTZ,
    last_error        VARCHAR(300),
    last_http_status  INTEGER,
    delivered_at      TIMESTAMPTZ,
    _created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    _updated_at       TIMESTAMPTZ,
    CONSTRAINT ck_outbound_delivered_consistent CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))
  );`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_outbound_deliveries_event ON ${DELIVERIES} (destination, event_id);`);
  await sql.query(
    `CREATE INDEX IF NOT EXISTS ix_outbound_deliveries_pending ON ${DELIVERIES} (destination, _tenant_id, next_attempt_at) WHERE status = 'pending';`,
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS ix_outbound_deliveries_aggregate ON ${DELIVERIES} (destination, aggregate_type, aggregate_id, aggregate_version);`,
  );

  await sql.query(`CREATE TABLE IF NOT EXISTS ${PROJECTION} (
    _id                     BIGSERIAL PRIMARY KEY,
    erp_recovery_id         UUID          NOT NULL,
    _tenant_id              BIGINT,
    loan_id                 BIGINT,
    installment_id          BIGINT,
    partner_profile_id      BIGINT,
    erp_installment_id      UUID          NOT NULL,
    erp_payable_id          UUID,
    settlement_reference    VARCHAR(120),
    amount_covered          NUMERIC(18,2) CHECK (amount_covered > 0),
    amount_recovered        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_recovered >= 0),
    currency_code           VARCHAR(3),
    coverage_paid_at        TIMESTAMPTZ,
    recovery_status         VARCHAR(30)   NOT NULL DEFAULT 'OPEN',
    recovery_version        BIGINT        NOT NULL DEFAULT 0,
    settled_event_key       VARCHAR(200),
    _created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    _updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
  );`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_installment_coverage_recovery ON ${PROJECTION} (erp_recovery_id);`);
  await sql.query(
    `CREATE INDEX IF NOT EXISTS ix_installment_coverage_core ON ${PROJECTION} (_tenant_id, loan_id, installment_id) WHERE installment_id IS NOT NULL;`,
  );
}

/**
 * El `down` no borra hechos recibidos ni entregas: sólo retira las tablas si están vacías
 * (reinstalación o el `down → up` de CI). Con filas, se niega y lo dice.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = queryInterface.sequelize;
  await sql.query(`
DO $$
BEGIN
  IF (to_regclass('${INBOX}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${INBOX}))
     OR (to_regclass('${DELIVERIES}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${DELIVERIES}))
     OR (to_regclass('${PROJECTION}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${PROJECTION})) THEN
    RAISE EXCEPTION 'integración ERP con filas: no se revierte para no perder hechos recibidos ni entregas';
  END IF;
END $$;`);
  await sql.query(`DROP TABLE IF EXISTS ${PROJECTION};`);
  await sql.query(`DROP TABLE IF EXISTS ${DELIVERIES};`);
  await sql.query(`DROP TABLE IF EXISTS ${VERSIONS};`);
  await sql.query(`DROP TABLE IF EXISTS ${INBOX};`);
}
