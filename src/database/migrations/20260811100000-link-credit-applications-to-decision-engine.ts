/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * La solicitud recuerda QUÉ decidió, no sólo qué se decidió.
 *
 * `credit_applications` ya guardaba `risk_assessment_run_id`, que apunta al heurístico interno
 * (`risk_heuristic_v0`), y `decided_by_internal_user_id`, que apunta a una persona. Faltaba la
 * tercera posibilidad, que es la que debería ser la normal: una política versionada, aprobada y
 * auditable ejecutada en el motor de decisión.
 *
 * Sin estas columnas la integración con el motor sería un cálculo que se hace y se tira. Con ellas,
 * cada solicitud queda atada a una ejecución concreta y a la versión del artefacto que la produjo,
 * el préstamo hereda esa atadura al desembolsar, y el desenlace real puede volver meses después y
 * atribuirse a la versión correcta. Es la cadena entera: decisión → dinero → resultado → medida.
 *
 * `decision_mode` existe para que quede escrito CÓMO se resolvió cada caso. Sin ella, un periodo con
 * el motor caído —resuelto a mano— es indistinguible de uno automatizado, y cualquier medida sobre
 * esos meses mezclaría dos poblaciones distintas creyendo que son una.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD COLUMN IF NOT EXISTS decision_execution_id        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS decision_artifact_version_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS decision_subject_reference   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS decision_mode                VARCHAR(30),
  ADD COLUMN IF NOT EXISTS decision_score               NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS decision_risk_band           VARCHAR(40),
  ADD COLUMN IF NOT EXISTS decision_reasons_json        JSONB;
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_applications_decision_mode') THEN
    ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_decision_mode
      CHECK (decision_mode IS NULL OR decision_mode IN ('decision_engine','manual','engine_unavailable_manual'));
  END IF;
END
$$;
`);

  /** Ir de una ejecución del motor a la solicitud que la originó, para auditar un caso concreto. */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_credit_applications_decision_execution
  ON ${APPLICATIONS} (_tenant_id, decision_execution_id)
  WHERE decision_execution_id IS NOT NULL;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ix_credit_applications_decision_execution;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP CONSTRAINT IF EXISTS ck_credit_applications_decision_mode,
  DROP COLUMN IF EXISTS decision_reasons_json,
  DROP COLUMN IF EXISTS decision_risk_band,
  DROP COLUMN IF EXISTS decision_score,
  DROP COLUMN IF EXISTS decision_mode,
  DROP COLUMN IF EXISTS decision_subject_reference,
  DROP COLUMN IF EXISTS decision_artifact_version_id,
  DROP COLUMN IF EXISTS decision_execution_id;
`);
}
