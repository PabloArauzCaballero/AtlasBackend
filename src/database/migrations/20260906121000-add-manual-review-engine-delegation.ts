/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Impide que la misma revisión manual se decida en dos sitios distintos.
 * @system ata el caso de revisión de Atlas a la ejecución del Motor que ya abrió el suyo.
 */
import { QueryInterface, DataTypes } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { schema: atlasSchemaFor('manual_review_cases'), tableName: 'manual_review_cases' };

/**
 * Dos bandejas para el mismo caso.
 *
 * ## Lo que encontró la auditoría del 2026-09-06
 *
 * Cuando el Motor de Decisión resuelve una evaluación con «esto lo mira una persona», el Motor abre
 * su propio caso: `decision_manual_review_case`, con `execution_id` ÚNICO y obligatorio, su
 * expediente, sus imágenes, su petición de información y su auditoría. Y AtlasBackend abría además
 * el suyo en `manual_review_cases`, que el portal interno dejaba resolver con otro formulario.
 *
 * El mismo cliente esperando en dos colas, con dos personas capaces de decidir cosas distintas y dos
 * bitácoras que no se hablan. No es un defecto ruidoso: las dos pantallas funcionan, y el problema
 * sólo se ve cuando alguien pregunta quién aprobó y las dos respuestas no coinciden.
 *
 * ## Por qué NO se borra el caso local
 *
 * Porque el caso local es el ancla del flujo de alta: `manualReviewCaseId` viaja en la respuesta de
 * la evaluación y el onboarding lo usa. Y porque cuando el Motor NO decidió —está caído, o no hay
 * artefacto— no existe ninguna ejecución a la que colgar un caso del Motor: su tabla lo exige. En
 * ese escalón, el caso local sigue siendo la única bandeja y hay que poder resolverlo aquí.
 *
 * Lo que se añade es la ARISTA: con `decision_execution_id` puesto, este caso está DELEGADO —la
 * decisión se toma en el Motor y el backend rechaza cerrarlo desde el portal—. Sin él, se decide
 * aquí como siempre.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.addColumn(TABLA, 'decision_execution_id', {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${TABLA.schema}.manual_review_cases.decision_execution_id IS
     'Ejecución del Motor que abrió su propio caso de revisión. Con valor, este caso está delegado: se decide en el Motor, no en el portal.'`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS manual_review_cases_decision_execution_idx
       ON ${TABLA.schema}.manual_review_cases (decision_execution_id)
     WHERE decision_execution_id IS NOT NULL`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DROP INDEX IF EXISTS ${TABLA.schema}.manual_review_cases_decision_execution_idx`,
  );
  await queryInterface.removeColumn(TABLA, 'decision_execution_id');
}
