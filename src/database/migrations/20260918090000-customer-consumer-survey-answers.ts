/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La fase 4 del alta pregunta hábitos de consumo declarados; lo que puntúa es su consistencia con el extracto y lo declarado en la fase 3.
 * @system crea `customer_consumer_survey_answers`: una fila por (cliente, versión, pregunta), con el tiempo que tardó en contestar. Sólo DDL.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const ANSWERS = `${atlasSchemaFor('customer_consumer_survey_answers')}.customer_consumer_survey_answers`;

/*
 * Una fila por pregunta y no un JSON con todas: el evaluador de elegibilidad cuenta preguntas
 * contestadas para saber si la sección está completa, y el riesgo cruza cada respuesta con un dato
 * observado distinto. `answered_in_ms` es la única «respuesta» que la persona no elige: menos de
 * 1,5 s dice que no leyó la pregunta, y eso es una señal aunque la respuesta sea la «buena».
 *
 * `answer_code` guarda la opción elegida y `answer_value` un número cuando la pregunta lo es (la
 * cuota máxima). Nunca texto libre.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ANSWERS} (
  _id BIGSERIAL PRIMARY KEY,
  _tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  onboarding_flow_id BIGINT,
  survey_version VARCHAR(40) NOT NULL,
  question_code VARCHAR(60) NOT NULL,
  answer_code VARCHAR(60),
  answer_value NUMERIC(14, 2),
  answered_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (answered_in_ms >= 0),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  _updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_consumer_survey_answers_question
  ON ${ANSWERS} (_tenant_id, customer_id, survey_version, question_code);
CREATE INDEX IF NOT EXISTS ix_customer_consumer_survey_answers_customer
  ON ${ANSWERS} (_tenant_id, customer_id, answered_at DESC);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ANSWERS};`);
}
