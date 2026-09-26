/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La revocación de un consentimiento llega al motor aunque esté caído al revocar (P-09, B12).
 * @system crea `decision_consent_replications`: el estado deseado por sujeto y finalidad, con reintento.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('decision_consent_replications');
const TABLE = `${SCHEMA}.decision_consent_replications`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * Por qué hace falta.
 *
 * `DecisionEngineClient.recordConsent/revokeConsent` devolvían `false` al fallar y nadie volvía a
 * intentarlo: una revocación hecha con el motor caído no llegaba nunca, y el motor seguía decidiendo
 * con un permiso que el titular ya había retirado. Aquí queda escrito el ÚLTIMO estado que el motor
 * debe conocer por sujeto y finalidad (`grant` o `revoke`), `pending` hasta que el motor lo acusa.
 * Una fila por `(tenant, sujeto, finalidad)`: una revocación posterior pisa a un permiso sin
 * replicar, que es exactamente lo que el motor debe acabar sabiendo.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TABLE} (
  _id                BIGSERIAL PRIMARY KEY,
  _tenant_id         BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  customer_id        BIGINT       NOT NULL,
  subject_reference  VARCHAR(128) NOT NULL,
  purpose_code       VARCHAR(100) NOT NULL,
  action             VARCHAR(10)  NOT NULL CHECK (action IN ('grant','revoke')),
  basis              VARCHAR(40),
  granted_at         TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  source_consent_id  BIGINT,
  status             VARCHAR(20)  NOT NULL CHECK (status IN ('pending','synced')),
  attempts           INTEGER      NOT NULL DEFAULT 0,
  next_attempt_at    TIMESTAMPTZ  NOT NULL,
  last_error         TEXT,
  requested_at       TIMESTAMPTZ  NOT NULL,
  synced_at          TIMESTAMPTZ,
  _created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  _updated_at        TIMESTAMPTZ
);`);
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_consent_replications_subject_purpose
       ON ${TABLE} (_tenant_id, subject_reference, purpose_code);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_decision_consent_replications_due
       ON ${TABLE} (next_attempt_at) WHERE status = 'pending';`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_decision_consent_replications_customer
       ON ${TABLE} (_tenant_id, customer_id) WHERE status = 'pending';`,
  );
}

/** Igual que las reservas: sólo se retira vacía, para no perder el rastro de qué supo el motor. */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF to_regclass('${TABLE}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${TABLE}) THEN
    RAISE EXCEPTION 'decision_consent_replications tiene filas: no se revierte para no perder la cola de sincronización';
  END IF;
END $$;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
