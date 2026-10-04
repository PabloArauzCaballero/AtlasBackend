/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Lo que el Motor habría decidido sobre cada solicitud del titular queda guardado junto a ella, para medir si acierta antes de darle autoridad.
 * @system `data_subject_requests` gana el veredicto del Motor (decisión, motivo, acción, señales, versión), las entradas que usó y el modo (sombra).
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = `${atlasSchemaFor('data_subject_requests')}.data_subject_requests`;

/**
 * Sólo añade columnas, todas nulables salvo el contador de intentos (con valor por omisión): ninguna fila existente cambia
 * de significado y la vista de `read_api` que lee la tabla selecciona columnas por nombre.
 *
 * `engine_inputs_json` guarda las variables que se mandaron al Motor: son booleanos, contadores y el código del dato —nada
 * personal— y son la explicación que ve quien revisa («lo mandó a una persona porque el correo cambió hace 3 días»).
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLA}
  ADD COLUMN IF NOT EXISTS decision_mode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS engine_decision VARCHAR(20),
  ADD COLUMN IF NOT EXISTS engine_reason_code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS engine_action VARCHAR(30),
  ADD COLUMN IF NOT EXISTS engine_risk_signals SMALLINT,
  ADD COLUMN IF NOT EXISTS engine_reevaluate_credit BOOLEAN,
  ADD COLUMN IF NOT EXISTS engine_inputs_json JSONB,
  ADD COLUMN IF NOT EXISTS engine_execution_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS engine_artifact_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS engine_artifact_version_id VARCHAR(60),
  ADD COLUMN IF NOT EXISTS engine_decided_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS engine_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engine_last_error VARCHAR(300);

ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_decision_mode;
ALTER TABLE ${TABLA}
  ADD CONSTRAINT ck_data_subject_requests_decision_mode
  CHECK (decision_mode IS NULL OR decision_mode IN ('shadow', 'enforce'));

ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_engine_decision;
ALTER TABLE ${TABLA}
  ADD CONSTRAINT ck_data_subject_requests_engine_decision
  CHECK (engine_decision IS NULL OR engine_decision IN ('ACEPTAR', 'RECHAZAR', 'REVISION_HUMANA'));

CREATE INDEX IF NOT EXISTS ix_data_subject_requests_engine_pending
  ON ${TABLA} (_tenant_id, requested_at)
  WHERE engine_decided_at IS NULL AND status IN ('received', 'in_progress') AND _deleted = FALSE;
`);
}

/**
 * Bajar borraría lo que el Motor decidió, que es la medida con la que se decide si darle autoridad. Si ya hay veredictos,
 * se aborta: perder esa evidencia en silencio obligaría a repetir semanas de sombra.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE engine_decided_at IS NOT NULL OR engine_attempts > 0`,
  );
  const conVeredicto = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  if (conVeredicto > 0) {
    throw new Error(
      `No se puede revertir: ${conVeredicto} solicitud(es) del titular ya tienen un veredicto o un intento del Motor. ` +
        'Revertir borraría la evidencia de la fase en sombra; expórtala antes de bajar esta migración.',
    );
  }
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('data_subject_requests')}.ix_data_subject_requests_engine_pending;
ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_engine_decision;
ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_decision_mode;
ALTER TABLE ${TABLA}
  DROP COLUMN IF EXISTS engine_last_error,
  DROP COLUMN IF EXISTS engine_attempts,
  DROP COLUMN IF EXISTS engine_decided_at,
  DROP COLUMN IF EXISTS engine_artifact_version_id,
  DROP COLUMN IF EXISTS engine_artifact_code,
  DROP COLUMN IF EXISTS engine_execution_id,
  DROP COLUMN IF EXISTS engine_inputs_json,
  DROP COLUMN IF EXISTS engine_reevaluate_credit,
  DROP COLUMN IF EXISTS engine_risk_signals,
  DROP COLUMN IF EXISTS engine_action,
  DROP COLUMN IF EXISTS engine_reason_code,
  DROP COLUMN IF EXISTS engine_decision,
  DROP COLUMN IF EXISTS decision_mode;
`);
}
