/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PRODUCTS = `${atlasSchemaFor('credit_products')}.credit_products`;
const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;
const EVENTS = `${atlasSchemaFor('credit_application_events')}.credit_application_events`;

/**
 * Dominio de crédito: catálogo de productos y solicitudes.
 *
 * Hasta ahora no existía ninguna tabla, modelo ni endpoint relacionado con crédito: el backend
 * llevaba a un cliente hasta quedar habilitado y ahí se acababa el recorrido.
 *
 * Dos decisiones de diseño explícitas:
 *
 * 1. **El catálogo es dato, no código.** Montos, plazos, tasas y requisitos viven en filas que el
 *    área de negocio administra; el backend solo impone la estructura y las reglas de integridad.
 *    Por eso no hay ningún producto sembrado: inventar una tasa sería inventar una decisión ajena.
 *
 * 2. **La solicitud guarda la evidencia de por qué se aceptó.** `eligibility_evaluation_id` apunta a
 *    la evaluación concreta que la autorizó y `eligibility_snapshot_json` congela su resultado. Sin
 *    ese par, demostrar meses después con qué información se aceptó una solicitud exige reconstruir
 *    el estado del cliente en esa fecha, que es justamente lo que no se puede hacer.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // `credit` es un dominio nuevo: la migración que repartió las tablas por esquema ya corrió, así
  // que este esquema y sus permisos de runtime se crean aquí, con el mismo criterio de mínimo
  // privilegio (el rol de aplicación usa y escribe, pero no puede crear objetos).
  await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS "credit";`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${PRODUCTS} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT        NOT NULL,
  product_code            VARCHAR(60)   NOT NULL,
  product_name            VARCHAR(180)  NOT NULL,
  description             TEXT,
  currency_code           VARCHAR(3)    NOT NULL,
  min_amount              NUMERIC(18,2) NOT NULL,
  max_amount              NUMERIC(18,2) NOT NULL,
  min_term_months         INTEGER       NOT NULL,
  max_term_months         INTEGER       NOT NULL,
  annual_interest_rate    NUMERIC(7,4),
  min_monthly_income      NUMERIC(18,2),
  requires_manual_review  BOOLEAN       NOT NULL DEFAULT false,
  status                  VARCHAR(20)   NOT NULL DEFAULT 'draft',
  effective_from          TIMESTAMPTZ,
  effective_until         TIMESTAMPTZ,
  created_by_internal_user_id BIGINT,
  _created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ,
  _deleted                BOOLEAN       NOT NULL DEFAULT false
);
`);

  // Rangos coherentes por construcción: un producto con mínimo mayor que el máximo no puede existir.
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_products_ranges') THEN
    ALTER TABLE ${PRODUCTS} ADD CONSTRAINT ck_credit_products_ranges CHECK (
      min_amount > 0 AND max_amount >= min_amount
      AND min_term_months > 0 AND max_term_months >= min_term_months
      AND (annual_interest_rate IS NULL OR annual_interest_rate >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_products_status') THEN
    ALTER TABLE ${PRODUCTS} ADD CONSTRAINT ck_credit_products_status
      CHECK (status IN ('draft','active','suspended','retired'));
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_products_tenant_code
  ON ${PRODUCTS} (_tenant_id, product_code) WHERE _deleted = false;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_credit_products_tenant_status
  ON ${PRODUCTS} (_tenant_id, status) WHERE _deleted = false;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${APPLICATIONS} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT        NOT NULL,
  application_code          VARCHAR(40)   NOT NULL,
  customer_id               BIGINT        NOT NULL,
  credit_product_id         BIGINT        NOT NULL,
  requested_amount          NUMERIC(18,2) NOT NULL,
  requested_term_months     INTEGER       NOT NULL,
  currency_code             VARCHAR(3)    NOT NULL,
  purpose_code              VARCHAR(80),
  status                    VARCHAR(30)   NOT NULL DEFAULT 'submitted',
  eligibility_evaluation_id BIGINT,
  eligibility_snapshot_json JSONB         NOT NULL DEFAULT '{}'::jsonb,
  risk_assessment_run_id    BIGINT,
  decision_reason_code      VARCHAR(120),
  decided_at                TIMESTAMPTZ,
  decided_by_internal_user_id BIGINT,
  idempotency_key_hash      VARCHAR(128),
  submitted_at              TIMESTAMPTZ   NOT NULL,
  _created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ,
  _deleted                  BOOLEAN       NOT NULL DEFAULT false
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_applications_status') THEN
    ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_status
      CHECK (status IN ('submitted','under_review','approved','rejected','cancelled','expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_applications_amounts') THEN
    ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_amounts
      CHECK (requested_amount > 0 AND requested_term_months > 0);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_applications_code
  ON ${APPLICATIONS} (_tenant_id, application_code);
`);

  /**
   * Un cliente no puede tener dos solicitudes vivas a la vez. La regla se impone en la base y no
   * solo en el servicio: dos peticiones concurrentes con claves de idempotencia distintas pasarían
   * cualquier comprobación previa hecha fuera de la transacción.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_applications_open_per_customer
  ON ${APPLICATIONS} (_tenant_id, customer_id)
  WHERE _deleted = false AND status IN ('submitted','under_review');
`);

  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_credit_applications_customer
  ON ${APPLICATIONS} (_tenant_id, customer_id, submitted_at DESC) WHERE _deleted = false;
`);

  // Historial append-only de la solicitud, mismo criterio que el resto del dominio.
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${EVENTS} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT       NOT NULL,
  credit_application_id  BIGINT       NOT NULL,
  event_type             VARCHAR(40)  NOT NULL,
  previous_status        VARCHAR(30),
  new_status             VARCHAR(30),
  actor_type             VARCHAR(40)  NOT NULL,
  actor_internal_user_id BIGINT,
  reason_code            VARCHAR(120),
  payload_json           JSONB,
  notes                  TEXT,
  happened_at            TIMESTAMPTZ  NOT NULL,
  _created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_credit_application_events_application
  ON ${EVENTS} (_tenant_id, credit_application_id, happened_at DESC);
`);

  await queryInterface.sequelize.query(`
REVOKE CREATE ON SCHEMA "credit" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') THEN
    GRANT USAGE ON SCHEMA "credit" TO atlas_app_rw;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "credit" TO atlas_app_rw;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "credit" TO atlas_app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA "credit" FROM atlas_app_ro;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA "credit" FROM atlas_app_ro;
  END IF;
END$$;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${EVENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${APPLICATIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${PRODUCTS};`);
}
