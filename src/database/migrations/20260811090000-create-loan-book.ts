/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const LOANS = `${atlasSchemaFor('loans')}.loans`;
const INSTALLMENTS = `${atlasSchemaFor('loan_installments')}.loan_installments`;
const PAYMENTS = `${atlasSchemaFor('loan_payments')}.loan_payments`;
const ALLOCATIONS = `${atlasSchemaFor('loan_payment_allocations')}.loan_payment_allocations`;
const EVENTS = `${atlasSchemaFor('loan_events')}.loan_events`;
const OUTCOME_REPORTS = `${atlasSchemaFor('loan_outcome_reports')}.loan_outcome_reports`;
const SUBJECT_LINKS = `${atlasSchemaFor('decision_subject_links')}.decision_subject_links`;

/**
 * El libro de préstamos: lo que pasa DESPUÉS de aprobar.
 *
 * Hasta aquí el dominio de crédito terminaba en `credit_applications.status = 'approved'`. No había
 * desembolso, ni cronograma, ni cuota, ni cobro, ni mora, ni castigo. Para una operación de crédito
 * eso no es un módulo pendiente: es el producto, y su ausencia tiene una consecuencia que no se
 * arregla más tarde.
 *
 * El motor de decisión ya sabe registrar el desenlace real de cada decisión
 * (`decision_outcome_observation`, con su ventana en días) y calcular tasa de malos, falsos
 * rechazos, estabilidad poblacional e impacto adverso. Lo que no tenía era de dónde sacar el
 * desenlace: su propia documentación espera «el sistema de cobranza», que no existía. Sin libro de
 * préstamos ese bucle sólo puede alimentarse a mano, y una tasa de malos calculada sobre lo que
 * alguien se acordó de cargar no falla — miente.
 *
 * Decisiones de diseño:
 *
 * 1. **El dinero se lleva en enteros de la moneda menor.** `NUMERIC(18,2)` para importes, y toda
 *    suma se comprueba contra el total: un céntimo perdido por redondeo en el cronograma se
 *    convierte, doce cuotas después, en una cuota final que no cuadra.
 *
 * 2. **El pago no muta la cuota: se ASIGNA a ella.** `loan_payment_allocations` guarda cuánto de
 *    cada pago fue a capital, interés y mora de cada cuota. Un `paid_amount` acumulado y nada más
 *    hace imposible reconstruir o reversar un cobro, que es exactamente lo que pide un reclamo.
 *
 * 3. **El préstamo recuerda qué decisión lo originó** (`decision_execution_id`). Es la arista que
 *    faltaba entre los dos sistemas: sin ella, el desenlace observado no se puede atribuir a la
 *    versión del artefacto que lo decidió, y el monitoreo del motor mide sobre el aire.
 *
 * 4. **El envío del desenlace es una tabla, no una llamada.** `loan_outcome_reports` lleva su
 *    propio estado y reintentos. Un motor caído no puede hacer que se pierda para siempre el único
 *    dato que no se puede reconstruir después.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${LOANS} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT        NOT NULL,
  loan_code                    VARCHAR(40)   NOT NULL,
  customer_id                  BIGINT        NOT NULL,
  credit_application_id        BIGINT        NOT NULL,
  credit_product_id            BIGINT        NOT NULL,
  currency_code                VARCHAR(3)    NOT NULL,
  principal_amount             NUMERIC(18,2) NOT NULL,
  annual_interest_rate         NUMERIC(7,4)  NOT NULL DEFAULT 0,
  term_months                  INTEGER       NOT NULL,
  status                       VARCHAR(30)   NOT NULL DEFAULT 'pending_disbursement',
  disbursed_at                 TIMESTAMPTZ,
  first_due_date               DATE,
  maturity_date                DATE,
  scheduled_principal          NUMERIC(18,2) NOT NULL DEFAULT 0,
  scheduled_interest           NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_principal               NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_interest                NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_late_fee                NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_principal        NUMERIC(18,2) NOT NULL DEFAULT 0,
  days_past_due                INTEGER       NOT NULL DEFAULT 0,
  worst_days_past_due          INTEGER       NOT NULL DEFAULT 0,
  delinquency_bucket           VARCHAR(20)   NOT NULL DEFAULT 'current',
  delinquency_evaluated_at     TIMESTAMPTZ,
  closed_at                    TIMESTAMPTZ,
  written_off_at               TIMESTAMPTZ,
  written_off_amount           NUMERIC(18,2),
  write_off_reason_code        VARCHAR(120),
  decision_execution_id        VARCHAR(40),
  decision_artifact_version_id VARCHAR(40),
  decision_subject_reference   VARCHAR(128),
  disbursed_by_internal_user_id BIGINT,
  idempotency_key_hash         VARCHAR(128),
  _created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ,
  _deleted                     BOOLEAN       NOT NULL DEFAULT false
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loans_status') THEN
    ALTER TABLE ${LOANS} ADD CONSTRAINT ck_loans_status
      CHECK (status IN ('pending_disbursement','active','paid_off','written_off','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loans_bucket') THEN
    ALTER TABLE ${LOANS} ADD CONSTRAINT ck_loans_bucket
      CHECK (delinquency_bucket IN ('current','dpd_1_29','dpd_30_59','dpd_60_89','dpd_90_plus','written_off'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loans_amounts') THEN
    ALTER TABLE ${LOANS} ADD CONSTRAINT ck_loans_amounts CHECK (
      principal_amount > 0 AND term_months > 0 AND annual_interest_rate >= 0
      AND paid_principal >= 0 AND paid_interest >= 0 AND paid_late_fee >= 0
      AND outstanding_principal >= 0 AND days_past_due >= 0 AND worst_days_past_due >= 0
    );
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loans_tenant_code ON ${LOANS} (_tenant_id, loan_code);
`);

  /**
   * Una solicitud aprobada origina UN préstamo. La regla vive en la base porque dos peticiones de
   * desembolso concurrentes con claves de idempotencia distintas superarían cualquier comprobación
   * hecha fuera de la transacción — y el resultado sería dinero entregado dos veces.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loans_application
  ON ${LOANS} (_tenant_id, credit_application_id) WHERE _deleted = false;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loans_customer
  ON ${LOANS} (_tenant_id, customer_id, _created_at DESC) WHERE _deleted = false;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loans_status_bucket
  ON ${LOANS} (_tenant_id, status, delinquency_bucket) WHERE _deleted = false;
`);
  /** El barrido de mora busca préstamos vivos por fecha evaluada: sin este índice recorre la tabla. */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loans_delinquency_sweep
  ON ${LOANS} (_tenant_id, delinquency_evaluated_at NULLS FIRST)
  WHERE _deleted = false AND status = 'active';
`);
  /** Atribuir un desenlace a la ejecución que lo decidió es la consulta central del monitoreo. */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loans_decision_execution
  ON ${LOANS} (_tenant_id, decision_execution_id) WHERE decision_execution_id IS NOT NULL;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${INSTALLMENTS} (
  _id                 BIGSERIAL PRIMARY KEY,
  _tenant_id          BIGINT        NOT NULL,
  loan_id             BIGINT        NOT NULL,
  installment_number  INTEGER       NOT NULL,
  due_date            DATE          NOT NULL,
  principal_amount    NUMERIC(18,2) NOT NULL,
  interest_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  late_fee_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_principal      NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_interest       NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_late_fee       NUMERIC(18,2) NOT NULL DEFAULT 0,
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
  days_past_due       INTEGER       NOT NULL DEFAULT 0,
  settled_at          TIMESTAMPTZ,
  _created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at         TIMESTAMPTZ,
  _deleted            BOOLEAN       NOT NULL DEFAULT false
);
`);
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_installments_status') THEN
    ALTER TABLE ${INSTALLMENTS} ADD CONSTRAINT ck_loan_installments_status
      CHECK (status IN ('pending','partially_paid','paid','overdue','written_off'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_installments_amounts') THEN
    ALTER TABLE ${INSTALLMENTS} ADD CONSTRAINT ck_loan_installments_amounts CHECK (
      installment_number > 0 AND principal_amount >= 0 AND interest_amount >= 0
      AND late_fee_amount >= 0 AND paid_principal >= 0 AND paid_interest >= 0
      AND paid_late_fee >= 0 AND days_past_due >= 0
    );
  END IF;
END
$$;
`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_installments_number
  ON ${INSTALLMENTS} (_tenant_id, loan_id, installment_number) WHERE _deleted = false;
`);
  /** Cobranza pregunta «qué vence y sigue impago», y ordena por fecha. */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_installments_due
  ON ${INSTALLMENTS} (_tenant_id, due_date)
  WHERE _deleted = false AND status IN ('pending','partially_paid','overdue');
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${PAYMENTS} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT        NOT NULL,
  loan_id                   BIGINT        NOT NULL,
  payment_code              VARCHAR(40)   NOT NULL,
  amount                    NUMERIC(18,2) NOT NULL,
  currency_code             VARCHAR(3)    NOT NULL,
  payment_method            VARCHAR(40)   NOT NULL,
  external_reference        VARCHAR(160),
  received_at               TIMESTAMPTZ   NOT NULL,
  status                    VARCHAR(20)   NOT NULL DEFAULT 'applied',
  reversed_at               TIMESTAMPTZ,
  reversal_reason_code      VARCHAR(120),
  registered_by_internal_user_id BIGINT,
  idempotency_key_hash      VARCHAR(128),
  _created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ,
  _deleted                  BOOLEAN       NOT NULL DEFAULT false
);
`);
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_payments_status') THEN
    ALTER TABLE ${PAYMENTS} ADD CONSTRAINT ck_loan_payments_status
      CHECK (status IN ('applied','reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_payments_amount') THEN
    ALTER TABLE ${PAYMENTS} ADD CONSTRAINT ck_loan_payments_amount CHECK (amount > 0);
  END IF;
END
$$;
`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_payments_code ON ${PAYMENTS} (_tenant_id, payment_code);
`);
  /**
   * Idempotencia real del cobro. El mismo pago reintentado por la pasarela no puede aplicarse dos
   * veces, y el único momento en que eso se puede impedir con certeza es al insertar.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_payments_idempotency
  ON ${PAYMENTS} (_tenant_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL AND _deleted = false;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_payments_loan
  ON ${PAYMENTS} (_tenant_id, loan_id, received_at DESC) WHERE _deleted = false;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ALLOCATIONS} (
  _id                 BIGSERIAL PRIMARY KEY,
  _tenant_id          BIGINT        NOT NULL,
  loan_payment_id     BIGINT        NOT NULL,
  loan_installment_id BIGINT        NOT NULL,
  principal_applied   NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_applied    NUMERIC(18,2) NOT NULL DEFAULT 0,
  late_fee_applied    NUMERIC(18,2) NOT NULL DEFAULT 0,
  reversed            BOOLEAN       NOT NULL DEFAULT false,
  _created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`);
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_allocations_amounts') THEN
    ALTER TABLE ${ALLOCATIONS} ADD CONSTRAINT ck_loan_allocations_amounts CHECK (
      principal_applied >= 0 AND interest_applied >= 0 AND late_fee_applied >= 0
      AND (principal_applied + interest_applied + late_fee_applied) > 0
    );
  END IF;
END
$$;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_allocations_payment ON ${ALLOCATIONS} (_tenant_id, loan_payment_id);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_allocations_installment ON ${ALLOCATIONS} (_tenant_id, loan_installment_id);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${EVENTS} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT       NOT NULL,
  loan_id                BIGINT       NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_loan_events_loan ON ${EVENTS} (_tenant_id, loan_id, happened_at DESC);
`);

  /**
   * Cola de desenlaces hacia el motor.
   *
   * `window_days` es parte de la identidad: el mismo préstamo produce una observación a 30, otra a
   * 90 y otra a 180 días, y el motor las guarda por separado porque una cosecha se lee así. El
   * índice único impide duplicarlas; el estado y los intentos hacen que un motor caído sea un
   * reintento y no una pérdida.
   */
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${OUTCOME_REPORTS} (
  _id                   BIGSERIAL PRIMARY KEY,
  _tenant_id            BIGINT        NOT NULL,
  loan_id               BIGINT        NOT NULL,
  decision_execution_id VARCHAR(40)   NOT NULL,
  window_days           INTEGER       NOT NULL,
  label                 VARCHAR(40)   NOT NULL,
  amount                NUMERIC(18,4),
  source                VARCHAR(120)  NOT NULL,
  notes                 TEXT,
  status                VARCHAR(20)   NOT NULL DEFAULT 'pending',
  attempts              INTEGER       NOT NULL DEFAULT 0,
  last_error            TEXT,
  observed_at           TIMESTAMPTZ   NOT NULL,
  sent_at               TIMESTAMPTZ,
  _created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at           TIMESTAMPTZ
);
`);
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_outcome_reports_status') THEN
    ALTER TABLE ${OUTCOME_REPORTS} ADD CONSTRAINT ck_loan_outcome_reports_status
      CHECK (status IN ('pending','sent','failed','skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_outcome_reports_label') THEN
    ALTER TABLE ${OUTCOME_REPORTS} ADD CONSTRAINT ck_loan_outcome_reports_label
      CHECK (label IN ('GOOD','BAD','REJECTED_WOULD_HAVE_BEEN_GOOD','REJECTED_CONFIRMED_BAD','INDETERMINATE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_outcome_reports_window') THEN
    ALTER TABLE ${OUTCOME_REPORTS} ADD CONSTRAINT ck_loan_outcome_reports_window CHECK (window_days > 0);
  END IF;
END
$$;
`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_outcome_reports_window
  ON ${OUTCOME_REPORTS} (_tenant_id, loan_id, window_days);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_outcome_reports_pending
  ON ${OUTCOME_REPORTS} (_tenant_id, status, observed_at)
  WHERE status IN ('pending','failed');
`);

  /**
   * Correspondencia entre el cliente y el sujeto que ve el motor.
   *
   * El motor guarda `subject_reference_hash` a propósito: un identificador opaco, indexado para
   * atender solicitudes del titular sin conocer a nadie. Pero un hash es de una sola dirección, así
   * que el motor puede CONTAR las decisiones de un sujeto y no puede TRAER su historia. Esta tabla
   * es la única pieza autorizada a deshacer esa correspondencia, y vive en el core —donde el dato
   * personal ya reside— y no en el motor, que sigue sin saber a quién decide.
   */
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${SUBJECT_LINKS} (
  _id                BIGSERIAL PRIMARY KEY,
  _tenant_id         BIGINT       NOT NULL,
  customer_id        BIGINT       NOT NULL,
  subject_reference  VARCHAR(128) NOT NULL,
  purpose_code       VARCHAR(80)  NOT NULL,
  first_seen_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decision_count     INTEGER      NOT NULL DEFAULT 0,
  _created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at        TIMESTAMPTZ
);
`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_subject_links_reference
  ON ${SUBJECT_LINKS} (_tenant_id, subject_reference);
`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_subject_links_customer
  ON ${SUBJECT_LINKS} (_tenant_id, customer_id, purpose_code);
`);

  // Mismo criterio de mínimo privilegio que el resto del esquema `credit`: el rol de runtime usa y
  // escribe, no crea objetos; el rol de sólo lectura no ve nada de crédito.
  await queryInterface.sequelize.query(`
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
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SUBJECT_LINKS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${OUTCOME_REPORTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${EVENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ALLOCATIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${PAYMENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${INSTALLMENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${LOANS};`);
}
