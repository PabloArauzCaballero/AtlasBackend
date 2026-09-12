/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const POLICY_VERSIONS = `${atlasSchemaFor('rating_policy_versions')}.rating_policy_versions`;
const POLICY_BANDS = `${atlasSchemaFor('rating_policy_bands')}.rating_policy_bands`;
const LOAN_RATINGS = `${atlasSchemaFor('loan_risk_ratings')}.loan_risk_ratings`;
const CUSTOMER_RATINGS = `${atlasSchemaFor('customer_risk_ratings')}.customer_risk_ratings`;

/**
 * Calificación de la deuda y del cliente.
 *
 * Hasta aquí el backend sabía cuántos días de atraso tenía un préstamo (`days_past_due`) y en qué
 * tramo caía (`delinquency_bucket`), pero no lo CALIFICABA: no había categoría de riesgo, ni
 * porcentaje de previsión, ni una calificación del cliente que agregara todas sus operaciones. Un
 * tramo de mora es un hecho observado; una calificación es un juicio con consecuencia contable y
 * regulatoria, y son cosas distintas. `delinquency_bucket` responde «¿cuánto se atrasó?»; la
 * calificación responde «¿cuánto de esto vamos a perder y cuánto hay que previsionar?».
 *
 * Decisiones de diseño:
 *
 * 1. **La escala vive en la base, no en el código.** `rating_policy_versions` + `rating_policy_bands`
 *    guardan los umbrales de días y el porcentaje de previsión de cada categoría. Un regulador que
 *    cambia un umbral, o un producto con matriz propia, no deberían exigir un despliegue — y sobre
 *    todo: una calificación emitida hace seis meses tiene que poder recalcularse con la política que
 *    regía ENTONCES. Por eso cada calificación guarda `policy_version_id` y no sólo su resultado.
 *
 * 2. **La calificación es histórica y append-only, con puntero al presente.** Cada recalificación
 *    inserta una fila nueva y baja `is_current` de la anterior. Sobrescribir en sitio haría
 *    imposible reconstruir la migración de categorías entre dos cierres, que es exactamente el
 *    reporte que pide riesgo: cuántos créditos bajaron de B a C este mes y por cuánto dinero.
 *
 * 3. **El cliente hereda la PEOR categoría de sus operaciones** (arrastre o contaminación), no el
 *    promedio. Un cliente con nueve créditos al día y uno en pérdida no es un cliente promedio-bueno:
 *    es un cliente que dejó de pagar. Promediar produciría exactamente el error que la
 *    regla de arrastre existe para evitar. Es configurable por política (`contamination_enabled`)
 *    porque no toda cartera la aplica igual.
 *
 * 4. **La previsión se calcula sobre la exposición viva del momento** y se congela en la fila. Un
 *    porcentaje aplicado sobre un saldo que después cambió no es reproducible, y una previsión que
 *    no se puede reproducir no se puede auditar.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${POLICY_VERSIONS} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT,
  policy_code                  VARCHAR(80)   NOT NULL,
  version_code                 VARCHAR(40)   NOT NULL,
  scale_code                   VARCHAR(40)   NOT NULL,
  status                       VARCHAR(20)   NOT NULL DEFAULT 'draft',
  effective_from               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  effective_until              TIMESTAMPTZ,
  contamination_enabled        BOOLEAN       NOT NULL DEFAULT true,
  description                  TEXT,
  approved_by_platform_user_id BIGINT,
  approved_at                  TIMESTAMPTZ,
  _created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rating_policy_versions_status') THEN
    ALTER TABLE ${POLICY_VERSIONS} ADD CONSTRAINT ck_rating_policy_versions_status
      CHECK (status IN ('draft','active','retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rating_policy_versions_window') THEN
    ALTER TABLE ${POLICY_VERSIONS} ADD CONSTRAINT ck_rating_policy_versions_window
      CHECK (effective_until IS NULL OR effective_until > effective_from);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_rating_policy_versions_code
  ON ${POLICY_VERSIONS} (COALESCE(_tenant_id, 0), policy_code, version_code);
`);

  /**
   * UNA sola política activa por tenant y código, impuesta en la base.
   *
   * Dos políticas activas a la vez no producen un error visible: producen calificaciones que
   * dependen de cuál leyó primero la consulta. El día que se note, la cartera ya está calificada con
   * dos matrices distintas y no hay forma de saber cuál fila usó cuál.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_rating_policy_versions_active
  ON ${POLICY_VERSIONS} (COALESCE(_tenant_id, 0), policy_code) WHERE status = 'active';
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${POLICY_BANDS} (
  _id                 BIGSERIAL PRIMARY KEY,
  policy_version_id   BIGINT        NOT NULL,
  grade               VARCHAR(4)    NOT NULL,
  grade_label         VARCHAR(60)   NOT NULL,
  severity_rank       INTEGER       NOT NULL,
  min_days_past_due   INTEGER       NOT NULL,
  max_days_past_due   INTEGER,
  provision_rate      NUMERIC(6,4)  NOT NULL,
  _created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rating_policy_bands_range') THEN
    ALTER TABLE ${POLICY_BANDS} ADD CONSTRAINT ck_rating_policy_bands_range CHECK (
      min_days_past_due >= 0
      AND (max_days_past_due IS NULL OR max_days_past_due >= min_days_past_due)
      AND severity_rank >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rating_policy_bands_provision') THEN
    ALTER TABLE ${POLICY_BANDS} ADD CONSTRAINT ck_rating_policy_bands_provision
      CHECK (provision_rate >= 0 AND provision_rate <= 1);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_rating_policy_bands_grade
  ON ${POLICY_BANDS} (policy_version_id, grade);
`);
  /**
   * El orden de severidad es único dentro de la política porque es lo que decide el arrastre. Dos
   * categorías empatadas en rango harían que «la peor» dependa del orden de lectura, y el cliente
   * calificaría distinto en dos consultas iguales.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_rating_policy_bands_rank
  ON ${POLICY_BANDS} (policy_version_id, severity_rank);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${LOAN_RATINGS} (
  _id                 BIGSERIAL PRIMARY KEY,
  _tenant_id          BIGINT        NOT NULL,
  loan_id             BIGINT        NOT NULL,
  customer_id         BIGINT        NOT NULL,
  policy_version_id   BIGINT        NOT NULL,
  grade               VARCHAR(4)    NOT NULL,
  grade_label         VARCHAR(60)   NOT NULL,
  severity_rank       INTEGER       NOT NULL,
  days_past_due       INTEGER       NOT NULL DEFAULT 0,
  delinquency_bucket  VARCHAR(20)   NOT NULL,
  exposure_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  provision_rate      NUMERIC(6,4)  NOT NULL DEFAULT 0,
  provision_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  previous_grade      VARCHAR(4),
  rating_reason       VARCHAR(40)   NOT NULL DEFAULT 'days_past_due',
  is_current          BOOLEAN       NOT NULL DEFAULT true,
  rated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_risk_ratings_amounts') THEN
    ALTER TABLE ${LOAN_RATINGS} ADD CONSTRAINT ck_loan_risk_ratings_amounts CHECK (
      days_past_due >= 0 AND exposure_amount >= 0 AND provision_amount >= 0
      AND provision_rate >= 0 AND provision_rate <= 1
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loan_risk_ratings_reason') THEN
    ALTER TABLE ${LOAN_RATINGS} ADD CONSTRAINT ck_loan_risk_ratings_reason
      CHECK (rating_reason IN ('days_past_due','written_off','manual_override','policy_change'));
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_risk_ratings_current
  ON ${LOAN_RATINGS} (_tenant_id, loan_id) WHERE is_current = true;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_risk_ratings_history
  ON ${LOAN_RATINGS} (_tenant_id, loan_id, rated_at DESC);
`);
  /** La distribución de la cartera por categoría es la consulta de cierre: se resuelve por índice. */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_risk_ratings_portfolio
  ON ${LOAN_RATINGS} (_tenant_id, grade) WHERE is_current = true;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loan_risk_ratings_customer
  ON ${LOAN_RATINGS} (_tenant_id, customer_id) WHERE is_current = true;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CUSTOMER_RATINGS} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT        NOT NULL,
  customer_id             BIGINT        NOT NULL,
  policy_version_id       BIGINT        NOT NULL,
  grade                   VARCHAR(4)    NOT NULL,
  grade_label             VARCHAR(60)   NOT NULL,
  severity_rank           INTEGER       NOT NULL,
  worst_days_past_due     INTEGER       NOT NULL DEFAULT 0,
  rated_loan_count        INTEGER       NOT NULL DEFAULT 0,
  total_exposure_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_provision_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
  driving_loan_id         BIGINT,
  previous_grade          VARCHAR(4),
  rating_reason           VARCHAR(40)   NOT NULL DEFAULT 'worst_operation',
  is_current              BOOLEAN       NOT NULL DEFAULT true,
  rated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customer_risk_ratings_amounts') THEN
    ALTER TABLE ${CUSTOMER_RATINGS} ADD CONSTRAINT ck_customer_risk_ratings_amounts CHECK (
      worst_days_past_due >= 0 AND rated_loan_count >= 0
      AND total_exposure_amount >= 0 AND total_provision_amount >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customer_risk_ratings_reason') THEN
    ALTER TABLE ${CUSTOMER_RATINGS} ADD CONSTRAINT ck_customer_risk_ratings_reason
      CHECK (rating_reason IN ('worst_operation','no_open_debt','manual_override','policy_change'));
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_risk_ratings_current
  ON ${CUSTOMER_RATINGS} (_tenant_id, customer_id) WHERE is_current = true;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_customer_risk_ratings_history
  ON ${CUSTOMER_RATINGS} (_tenant_id, customer_id, rated_at DESC);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_customer_risk_ratings_grade
  ON ${CUSTOMER_RATINGS} (_tenant_id, grade) WHERE is_current = true;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CUSTOMER_RATINGS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${LOAN_RATINGS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${POLICY_BANDS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${POLICY_VERSIONS};`);
}
