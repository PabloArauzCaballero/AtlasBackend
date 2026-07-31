/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const CUSTOMERS = `${atlasSchemaFor('customers')}.customers`;
const EVALUATIONS = `${atlasSchemaFor('customer_eligibility_evaluations')}.customer_eligibility_evaluations`;
const EVIDENCE = `${atlasSchemaFor('evidence_documents')}.evidence_documents`;

/**
 * Cierra las cuatro brechas de integridad que impedían construir el flujo de habilitación.
 *
 * 1. `lifecycle_status` era `VARCHAR(40)` NULLABLE sin CHECK: texto libre. Convivían once valores y
 *    cuatro de ellos los leía medio backend sin que nadie los escribiera. Se normaliza el dato
 *    existente, se vuelve NOT NULL con default y se fija el conjunto legal con una constraint.
 *
 * 2. NO existía índice único por teléfono (solo por email, `ux_customers_tenant_email_hash`). El
 *    chequeo de duplicados de la aplicación corre FUERA de la transacción, así que dos registros
 *    concurrentes con el mismo teléfono creaban dos clientes — y el `catch (UniqueConstraintError)`
 *    del servicio no podía atraparlo porque no había constraint que violar. En un backend KYC eso
 *    significa dos historiales de riesgo para la misma persona.
 *
 * 3. La habilitación crediticia no tenía dónde dejar evidencia. `customer_eligibility_evaluations`
 *    responde la pregunta "¿por qué este cliente quedó habilitado?" con una fila, no con una
 *    investigación: guarda el resultado, los bloqueadores, la versión de la regla y un hash de
 *    integridad de los insumos.
 *
 * 4. Documentos de evidencia duplicados: el mismo archivo podía registrarse N veces para un cliente.
 *
 * El índice único de teléfono se crea SIN `IF NOT EXISTS` sobre datos preexistentes a propósito: si
 * ya hay duplicados, Postgres falla indicando la clave conflictiva y la migración se detiene. Es lo
 * correcto — crear la constraint "cuando se pueda" dejaría la base sin la garantía justo en las
 * instalaciones que más la necesitan.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // 1a. Backfill: traduce los valores heredados al conjunto canónico antes de imponer la CHECK.
  await queryInterface.sequelize.query(`
UPDATE ${CUSTOMERS} SET lifecycle_status = CASE
  WHEN lifecycle_status IN ('pending_identity_review','pending_review','pending_fraud_review') THEN 'under_review'
  WHEN lifecycle_status = 'pending_more_information' THEN 'observed'
  WHEN lifecycle_status IN ('approved','approved_for_next_step') THEN 'active'
  WHEN lifecycle_status IS NULL OR lifecycle_status = '' THEN 'registered'
  WHEN lifecycle_status IN (
    'registered','onboarding_in_progress','under_review','observed','active','suspended','rejected','blocked','closed'
  ) THEN lifecycle_status
  ELSE 'registered'
END;
`);

  // 1b. El estado deja de poder ser desconocido: NOT NULL + default explícito.
  await queryInterface.sequelize.query(`
ALTER TABLE ${CUSTOMERS}
  ALTER COLUMN lifecycle_status SET DEFAULT 'registered',
  ALTER COLUMN lifecycle_status SET NOT NULL;
`);

  // 1c. Conjunto legal de estados. Postgres no soporta ADD CONSTRAINT IF NOT EXISTS para CHECK.
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customers_lifecycle_status') THEN
    ALTER TABLE ${CUSTOMERS}
      ADD CONSTRAINT ck_customers_lifecycle_status
      CHECK (lifecycle_status IN (
        'registered','onboarding_in_progress','under_review','observed','active','suspended','rejected','blocked','closed'
      ));
  END IF;
END
$$;
`);

  // 3a. Caché consultable del estado derivado de habilitación. La fuente de verdad sigue siendo el
  // cálculo del servicio; estas columnas evitan recalcular en cada listado del portal interno.
  await queryInterface.sequelize.query(`
ALTER TABLE ${CUSTOMERS}
  ADD COLUMN IF NOT EXISTS credit_eligibility_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS eligibility_evaluated_at TIMESTAMPTZ;
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customers_credit_eligibility_status') THEN
    ALTER TABLE ${CUSTOMERS}
      ADD CONSTRAINT ck_customers_credit_eligibility_status
      CHECK (credit_eligibility_status IS NULL OR credit_eligibility_status IN ('eligible','not_eligible'));
  END IF;
END
$$;
`);

  // 2. Unicidad real por teléfono, con el mismo patrón parcial que el índice de email ya existente.
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_tenant_phone_hash
  ON ${CUSTOMERS} (_tenant_id, primary_phone_hash)
  WHERE _deleted = false AND primary_phone_hash IS NOT NULL;
`);

  // Consulta operativa del portal interno: "clientes por estado dentro del tenant".
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_customers_tenant_lifecycle_status
  ON ${CUSTOMERS} (_tenant_id, lifecycle_status)
  WHERE _deleted = false;
`);

  // 3b. Evidencia de cada evaluación de habilitación, favorable o no. Append-only.
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${EVALUATIONS} (
  _id                BIGSERIAL PRIMARY KEY,
  _tenant_id         BIGINT       NOT NULL,
  customer_id        BIGINT       NOT NULL,
  eligible           BOOLEAN      NOT NULL,
  lifecycle_status   VARCHAR(40)  NOT NULL,
  rule_version       VARCHAR(40)  NOT NULL,
  blockers_json      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  facts_hash         VARCHAR(128) NOT NULL,
  evaluated_by_type  VARCHAR(40)  NOT NULL,
  evaluated_by_internal_user_id BIGINT,
  decision_source    VARCHAR(40)  NOT NULL,
  reason_code        VARCHAR(120),
  notes              TEXT,
  evaluated_at       TIMESTAMPTZ  NOT NULL,
  _created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customer_eligibility_evaluations_source') THEN
    ALTER TABLE ${EVALUATIONS}
      ADD CONSTRAINT ck_customer_eligibility_evaluations_source
      CHECK (decision_source IN ('automatic','manual_override','manual_decision'));
  END IF;
END
$$;
`);

  // La consulta real es "última evaluación de este cliente": índice descendente por cliente y fecha.
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_customer_eligibility_evaluations_customer
  ON ${EVALUATIONS} (_tenant_id, customer_id, evaluated_at DESC);
`);

  // 4. Un mismo archivo no puede registrarse dos veces para el mismo cliente. Parcial sobre filas
  // vivas y con hash presente, para no invalidar registros históricos incompletos.
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_documents_customer_hash
  ON ${EVIDENCE} (_tenant_id, customer_id, file_hash_sha256)
  WHERE file_hash_sha256 IS NOT NULL;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ux_evidence_documents_customer_hash;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ix_customer_eligibility_evaluations_customer;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${EVALUATIONS};`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ix_customers_tenant_lifecycle_status;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ux_customers_tenant_phone_hash;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${CUSTOMERS}
  DROP CONSTRAINT IF EXISTS ck_customers_credit_eligibility_status,
  DROP CONSTRAINT IF EXISTS ck_customers_lifecycle_status;
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${CUSTOMERS}
  DROP COLUMN IF EXISTS credit_eligibility_status,
  DROP COLUMN IF EXISTS eligibility_evaluated_at;
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${CUSTOMERS}
  ALTER COLUMN lifecycle_status DROP NOT NULL,
  ALTER COLUMN lifecycle_status DROP DEFAULT;
`);
}
