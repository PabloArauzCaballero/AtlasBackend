/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Una solicitud que espera a una persona tiene que decir DÓNDE está su caso y de QUIÉN es la bandeja.
 * @system añade `manual_review_case_code` y `manual_review_case_source` a `credit_applications` (C-1).
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;
const RISK_RUNS = `${atlasSchemaFor('risk_assessment_runs')}.risk_assessment_runs`;

/**
 * El callejón sin salida de la revisión de crédito (C-1, plan 2026-09-25).
 *
 * ## Lo que pasaba
 *
 * Cuando el Motor respondía «esto lo mira una persona» SIN abrir caso en su cola, la solicitud
 * quedaba `under_review` y ningún sitio la tenía: el Motor no abrió bandeja, Atlas tampoco, y el
 * endpoint de decisión humana la rechazaba con 409 «delegada al Motor» sin mirar si el Motor había
 * abierto algo. Riesgo sí distinguía las dos cosas (`motorAbrioCaso`); crédito no, porque el código
 * del caso viajaba únicamente dentro del payload del evento de historial y ninguna columna lo
 * guardaba.
 *
 * ## Lo que se añade
 *
 * - `manual_review_case_code`: el código del caso que sostiene la revisión.
 * - `manual_review_case_source`: DE QUIÉN es esa bandeja. `engine` = el Motor abrió su caso y allí
 *   se resuelve (la decisión humana de Atlas se rechaza, como siempre); `atlas` = Atlas abrió el
 *   suyo en `manual_review_cases` porque el Motor no lo hizo, y se decide aquí.
 *
 * Es una columna aparte y no un prefijo del código porque «quién manda» es una regla de negocio que
 * no debe depender de cómo se formatee un identificador.
 *
 * Sin `UPDATE`: las solicitudes anteriores quedan con ambas columnas en NULL y conservan su
 * comportamiento (el servicio trata NULL + ejecución del Motor como delegada, que es lo que hacía
 * antes). No se rellenan por deducción: un caso que nadie registró no se puede inventar.
 *
 * ## Aparte: el vocabulario de `risk_assessment_runs.decision_source`
 *
 * No lleva CHECK, sólo un COMMENT que enumera los valores; se actualiza para incluir
 * `engine_no_decision` (C-5): el Motor respondió con `NO_DECISION`, que ya no se registra como
 * `heuristic_v0`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD COLUMN IF NOT EXISTS manual_review_case_code   VARCHAR(80),
  ADD COLUMN IF NOT EXISTS manual_review_case_source VARCHAR(10);
`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS} DROP CONSTRAINT IF EXISTS ck_credit_applications_review_case_source;
ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_review_case_source
  CHECK (manual_review_case_source IS NULL OR manual_review_case_source IN ('engine','atlas'));
`);

  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${APPLICATIONS}.manual_review_case_code IS
     'Código del caso de revisión que sostiene esta solicitud: el del Motor (source = engine) o el de manual_review_cases (source = atlas). NULL si no hay caso.'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${APPLICATIONS}.manual_review_case_source IS
     'De quién es la bandeja: engine = se resuelve en el Motor (la decisión humana de Atlas se rechaza); atlas = caso propio en manual_review_cases, se decide aquí. NULL en solicitudes anteriores.'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${RISK_RUNS}.decision_source IS
     'Escalón que resolvió la evaluación: decision_engine | engine_no_decision | ruleset | heuristic_v0. NULL en evaluaciones anteriores al registro de procedencia.'`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${RISK_RUNS}.decision_source IS
     'Escalón que resolvió la evaluación: decision_engine | ruleset | heuristic_v0. NULL en evaluaciones anteriores al registro de procedencia.'`,
  );
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP CONSTRAINT IF EXISTS ck_credit_applications_review_case_source,
  DROP COLUMN IF EXISTS manual_review_case_source,
  DROP COLUMN IF EXISTS manual_review_case_code;
`);
}
