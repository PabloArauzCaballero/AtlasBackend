/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Deja escrito en la evaluación de riesgo QUIÉN decidió y con qué ejecución del Motor.
 * @system añade `decision_source` y `decision_execution_id` a `risk_assessment_runs`.
 */
import { QueryInterface, DataTypes } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { schema: atlasSchemaFor('risk_assessment_runs'), tableName: 'risk_assessment_runs' };

/**
 * La procedencia se calculaba y se tiraba.
 *
 * `RiskPolicyDecisionService` resuelve cada evaluación por una cadena de tres escalones —Motor,
 * ruleset local, heurística v0— y publica `decisionSource` y `decisionExecutionId` en la RESPUESTA
 * de la evaluación. Nada de eso llegaba a una fila: lo único que se guardaba era el par
 * código/versión del modelo, que dice `atlas_decision_engine` pero no CUÁL ejecución.
 *
 * El resultado era una pantalla que miente por omisión. `/internal/operations/risk-assessments/[id]`
 * pinta reglas disparadas y contribuciones de features del heurístico local aunque la decisión la
 * haya tomado el Motor; sin la procedencia guardada no hay forma de que la pantalla se calle, ni de
 * saltar a la ejecución que de verdad decidió.
 *
 * Y sin `decision_source` en la fila no se pueden separar dos poblaciones que no son comparables:
 * un periodo con el Motor caído, resuelto por la política local, se mide junto a uno automatizado y
 * cualquier comparación entre meses compara cosas distintas creyendo que son una.
 *
 * ## Por qué nullable y sin relleno
 *
 * Las evaluaciones anteriores a esta migración NO tienen procedencia y no se puede inventar: poner
 * `heuristic_v0` a todo lo viejo sería fabricar un dato que nadie observó. `NULL` significa
 * exactamente «esta evaluación es anterior a que se registrara quién decidió», y las pantallas
 * pueden decirlo. Es el mismo criterio del expediente rellenado a posteriori, que se queda sin
 * manifiesto a propósito.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.addColumn(TABLA, 'decision_source', {
    type: DataTypes.STRING(40),
    allowNull: true,
  });
  await queryInterface.addColumn(TABLA, 'decision_execution_id', {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${TABLA.schema}.risk_assessment_runs.decision_source IS
     'Escalón que resolvió la evaluación: decision_engine | ruleset | heuristic_v0. NULL en evaluaciones anteriores al registro de procedencia.'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${TABLA.schema}.risk_assessment_runs.decision_execution_id IS
     'Ejecución del Motor de Decisión que decidió, cuando decision_source = decision_engine.'`,
  );

  /*
   * Índice parcial y no total: lo que se consulta es «las evaluaciones que resolvió el Motor» para
   * saltar a su ejecución, nunca «las que no». Un índice sobre la columna entera pagaría el coste
   * de escritura de todas las filas para responder una pregunta que sólo se hace sobre una parte.
   */
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS risk_assessment_runs_decision_execution_idx
       ON ${TABLA.schema}.risk_assessment_runs (decision_execution_id)
     WHERE decision_execution_id IS NOT NULL`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${TABLA.schema}.risk_assessment_runs_decision_execution_idx`);
  await queryInterface.removeColumn(TABLA, 'decision_execution_id');
  await queryInterface.removeColumn(TABLA, 'decision_source');
}
