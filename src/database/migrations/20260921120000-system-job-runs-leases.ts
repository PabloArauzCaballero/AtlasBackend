/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que un trabajo encolado se EJECUTE y se recupere si el worker muere.
 * @system columnas de lease y fencing en `system_job_runs`, más el índice que usa el claim.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('system_job_runs');
const RUNS = `${SCHEMA}.system_job_runs`;
const SEQUENCE = `${SCHEMA}.system_job_runs_fencing_seq`;

/**
 * Por qué hace falta.
 *
 * `SystemsStressRunService.queueStressRun` inserta una fila en `system_job_runs` con estado
 * `queued` y una nota que dice, literalmente, que "la ejecución real debe hacerla un worker externo
 * controlado". Ese worker no existe en ningún repositorio: `systems_stress_run` sólo aparece en el
 * servicio que la crea, en su prueba unitaria y en una semilla de demostración. Es decir, el plan de
 * estrés se guarda y no se ejecuta nunca, y la pantalla que lo dispara devuelve `queued: true`.
 *
 * Para que un worker pueda consumir esa cola hacen falta cuatro cosas que la tabla no tiene:
 *
 * - **`claimed_by` + `lease_expires_at`**: quién tomó el trabajo y hasta cuándo. Sin lease, un
 *   worker que muere a mitad deja la fila en `running` para siempre y nadie la vuelve a tomar.
 * - **`fencing_token`**: un entero creciente por reclamo. Es lo que impide que un worker que perdió
 *   el lease —porque se quedó pausado y otro lo recogió— confirme progreso viejo encima del nuevo.
 *   Sin fencing, un proceso "revivido" puede marcar completado un trabajo que otro está corriendo.
 * - **`heartbeat_at`**: renovación periódica. Distingue "sigue trabajando" de "se cayó".
 * - **`attempts`**: cuántas veces se reclamó. Sin contador, un trabajo que revienta siempre se
 *   reclama infinitas veces y se lleva el worker por delante.
 *
 * Todo es aditivo y nullable, así que se aplica sobre una base con datos sin tocar una sola fila
 * existente: las filas viejas quedan con lease nulo, que es exactamente "nadie la tiene".
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // La secuencia da el token de fencing. Es global a la tabla, no por fila: lo único que importa es
  // que sea monótona, para que un token viejo sea siempre menor que el vigente.
  await queryInterface.sequelize.query(`CREATE SEQUENCE IF NOT EXISTS ${SEQUENCE} AS bigint START 1;`);

  await queryInterface.sequelize.query(
    `ALTER TABLE ${RUNS}
       ADD COLUMN IF NOT EXISTS claimed_by varchar(120),
       ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
       ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
       ADD COLUMN IF NOT EXISTS fencing_token bigint,
       ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;`,
  );

  // El claim busca la fila más antigua que esté encolada o cuyo lease venció, filtrando por
  // `job_code`. Parcial porque las filas terminadas —que son la mayoría al poco tiempo— no se
  // consultan nunca por esta vía y no tienen por qué engordar el índice.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_system_job_runs_claimable
       ON ${RUNS} (job_code, status, _created_at)
       WHERE status IN ('queued', 'running');`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${SCHEMA}.ix_system_job_runs_claimable;`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${RUNS}
       DROP COLUMN IF EXISTS claimed_by,
       DROP COLUMN IF EXISTS lease_expires_at,
       DROP COLUMN IF EXISTS heartbeat_at,
       DROP COLUMN IF EXISTS fencing_token,
       DROP COLUMN IF EXISTS attempts;`,
  );
  await queryInterface.sequelize.query(`DROP SEQUENCE IF EXISTS ${SEQUENCE};`);
}
