/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { ATLAS_SCHEMAS } from '../domain-schemas.js';

type MigrationContext = {
  context: QueryInterface;
};

const TABLA = { tableName: 'partner_profiles', schema: ATLAS_SCHEMAS.PARTNER };

/**
 * La procedencia de la verificación del comercio.
 *
 * ## Qué arregla
 *
 * La decisión sobre el expediente de un comercio —lo que le habilita a cobrar— era íntegramente
 * humana y local: alguien pulsaba «Aprobar» en el portal y se escribían `decided_at` y
 * `decided_by_internal_user_id`. Mientras tanto, el Motor tenía desde hacía semanas el artefacto
 * `PARTNER_KYB_REVIEW` desplegado, con sus siete entradas y sus tres desenlaces, y **no lo
 * ejecutaba nadie**. Así que la política que decide qué comercio puede cobrar no tenía versión, ni
 * traza, ni forma de mover un umbral sin tocar código — y la que sí la tenía no se usaba.
 *
 * Estas columnas son la mitad que faltaba para poder decir, de cada expediente, QUIÉN decidió:
 * el Motor con qué versión y en qué ejecución, o una persona. Es la misma corrección que se hizo
 * en `risk_assessment_runs` (20260906120000): sin persistir la procedencia, la pantalla explicaba
 * con criterios locales decisiones que había tomado otro sistema.
 *
 * ## Por qué son nulables y no se rellenan
 *
 * `NULL` significa «se decidió antes de que esto se registrara», y se dice así en la pantalla.
 * Rellenarlas con un valor inventado convertiría una ausencia honesta en un dato falso: no hay
 * ninguna ejecución del Motor detrás de las decisiones ya tomadas, y fingir que la hay es peor
 * que no saberlo.
 *
 * ## `manual_review_case_code`
 *
 * Es el caso que el Motor abre cuando el expediente exige criterio humano. Con valor, la decisión
 * se toma EN EL MOTOR y Atlas no debe ofrecer un segundo formulario: la misma distinción que ya
 * gobierna `manual_review_cases.decision_execution_id`. Sin valor —una aprobación o un rechazo
 * automáticos, o el Motor caído— la decisión local es la única que hay y tiene que seguir
 * funcionando.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * `ADD COLUMN IF NOT EXISTS` y no `addColumn`, porque esta migración NO corre en una transacción:
   * si falla a mitad —como falló la primera vez, al crear el índice sobre una columna de borrado
   * lógico mal nombrada—, las columnas ya añadidas se quedan puestas y el reintento moría con
   * «column already exists». Un `up` que no se puede reintentar deja la base a medias y sin salida
   * automática. Es la regla de expand/contract escrita en `.claude/rules/80-database.md`.
   */
  const columnas: [string, string][] = [
    ['decision_execution_id', 'VARCHAR(64)'],
    ['decision_outcome', 'VARCHAR(40)'],
    ['decision_reason', 'VARCHAR(120)'],
    ['decision_artifact_version', 'VARCHAR(40)'],
    ['manual_review_case_code', 'VARCHAR(80)'],
    ['decision_evaluated_at', 'TIMESTAMPTZ'],
  ];
  for (const [columna, tipo] of columnas) {
    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLA.schema}.${TABLA.tableName} ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`,
    );
  }

  const comentarios: [string, string][] = [
    ['decision_execution_id', 'Ejecución del Motor que evaluó el expediente (PARTNER_KYB_REVIEW). NULL = decisión anterior al registro de procedencia, o el Motor no respondió.'],
    ['decision_outcome', 'Desenlace del Motor: APROBADO | RECHAZADO | REVISION_MANUAL.'],
    ['decision_reason', 'Motivo publicado por el Motor: KYB_COMPLETO | KYB_REQUISITOS_INCOMPLETOS | KYB_SENALES_OPERATIVAS.'],
    ['decision_artifact_version', 'Versión del artefacto que decidió. Es lo que permite releer una decisión vieja con la política que la tomó.'],
    ['manual_review_case_code', 'Caso abierto por el Motor cuando el expediente exige criterio humano. Con valor, la decisión se toma allí y el portal no la ofrece.'],
    ['decision_evaluated_at', 'Cuándo respondió el Motor. Distinto de decided_at, que es cuándo quedó firme el expediente.'],
  ];
  for (const [columna, comentario] of comentarios) {
    await queryInterface.sequelize.query(
      `COMMENT ON COLUMN ${TABLA.schema}.${TABLA.tableName}.${columna} IS '${comentario.replace(/'/g, "''")}'`,
    );
  }

  /*
   * Índice parcial: la pregunta que se hace es «¿qué expedientes esperan a que se resuelva su caso
   * en el Motor?», nunca la contraria. Un índice total pagaría la escritura de cada expediente para
   * responder sobre la minoría que tiene caso abierto.
   */
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS partner_profiles_manual_review_case_idx
       ON ${TABLA.schema}.${TABLA.tableName} (manual_review_case_code)
     WHERE manual_review_case_code IS NOT NULL`,
  );

  /*
   * El puente con el ERP: la cuenta B2B a la que corresponde este expediente. La columna ya existía
   * (`erp_account_id`) y no tenía índice, así que la búsqueda que el ERP necesita para saber si su
   * cuenta ya tiene expediente recorría la tabla entera. Único parcial: una cuenta del ERP no puede
   * tener dos expedientes —serían dos verificaciones distintas del mismo comercio, y ganaría la que
   * alguien mirara primero—.
   */
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS partner_profiles_erp_account_uq
       ON ${TABLA.schema}.${TABLA.tableName} (_tenant_id, erp_account_id)
     WHERE erp_account_id IS NOT NULL AND _deleted = false`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${TABLA.schema}.partner_profiles_erp_account_uq`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${TABLA.schema}.partner_profiles_manual_review_case_idx`);
  for (const columna of [
    'decision_evaluated_at',
    'manual_review_case_code',
    'decision_artifact_version',
    'decision_reason',
    'decision_outcome',
    'decision_execution_id',
  ]) {
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLA.schema}.${TABLA.tableName} DROP COLUMN IF EXISTS ${columna}`);
  }
}
