/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Proponer y aprobar un cambio de esquema era inalcanzable desde el portal interno: el change log sólo sabía guardar usuarios de plataforma.
 * @system `schema_change_log` acepta como actor a un usuario interno (proponente y aprobador) y guarda qué migración aplicó cada cambio aprobado.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const CHANGE_LOG = `${atlasSchemaFor('schema_change_log')}.schema_change_log`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;

/**
 * Hallazgo A4 del plan de procesos (P-35).
 *
 * `requester_platform_user_id` era `NOT NULL` con FK a `platform_users`, y el portal interno entra
 * con un token que sólo lleva `internalUserId`: no había forma de registrar a quien proponía. Aquí:
 *
 * - `requester_internal_user_id` y `approved_by_internal_user_id`: FK nullable a `internal_users`.
 * - `requester_platform_user_id` deja de ser `NOT NULL`, y un CHECK exige que al menos uno de los
 *   dos proponentes esté presente: una propuesta sin autor sigue siendo imposible.
 * - `applied_by_migration` / `applied_at`: la migración que materializó el cambio aprobado. La
 *   rellena `linkSchemaChangeToMigration` (migration-support) desde esa misma migración.
 *
 * No toca datos: las filas que ya existen tienen proponente de plataforma y cumplen el CHECK.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${CHANGE_LOG}
  ADD COLUMN IF NOT EXISTS requester_internal_user_id BIGINT
    REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_by_internal_user_id BIGINT
    REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_by_migration VARCHAR(255),
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE ${CHANGE_LOG} ALTER COLUMN requester_platform_user_id DROP NOT NULL;

ALTER TABLE ${CHANGE_LOG} DROP CONSTRAINT IF EXISTS ck_schema_change_log_requester_present;
ALTER TABLE ${CHANGE_LOG}
  ADD CONSTRAINT ck_schema_change_log_requester_present
  CHECK (requester_platform_user_id IS NOT NULL OR requester_internal_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_schema_change_log_requester_internal
  ON ${CHANGE_LOG}(requester_internal_user_id) WHERE requester_internal_user_id IS NOT NULL;
`);
}

/**
 * Volver atrás exige que toda propuesta tenga proponente de plataforma. Si ya hay propuestas hechas
 * por usuarios internos, se aborta con un mensaje: borrarlas destruiría auditoría y dejarlas haría
 * fallar el `SET NOT NULL` con un error que no dice por qué.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM ${CHANGE_LOG} WHERE requester_platform_user_id IS NULL`,
  );
  const pending = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  if (pending > 0) {
    throw new Error(
      `No se puede revertir: ${pending} propuesta(s) de esquema tienen sólo proponente interno. ` +
        'Revertir obligaría a borrar esa auditoría; resuélvelo a mano antes de bajar esta migración.',
    );
  }

  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('schema_change_log')}.idx_schema_change_log_requester_internal;
ALTER TABLE ${CHANGE_LOG} DROP CONSTRAINT IF EXISTS ck_schema_change_log_requester_present;
ALTER TABLE ${CHANGE_LOG} ALTER COLUMN requester_platform_user_id SET NOT NULL;
ALTER TABLE ${CHANGE_LOG}
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS applied_by_migration,
  DROP COLUMN IF EXISTS approved_by_internal_user_id,
  DROP COLUMN IF EXISTS requester_internal_user_id;
`);
}
