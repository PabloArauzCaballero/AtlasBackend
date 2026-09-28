/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Una sesión que el cliente sigue usando no puede caducar sólo porque empezó hace más de dos horas.
 * @system añade `last_activity_at` a `customer_sessions`; el latido la escribe y `expire_stale_sessions` la lee.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SESSIONS = `${atlasSchemaFor('customer_sessions')}.customer_sessions`;

/**
 * Última actividad de la sesión (hallazgo B6 del plan de procesos, 2026-09-26).
 *
 * ## Por qué
 *
 * `expire_stale_sessions` caducaba por `started_at < ahora − ventana`: una sesión en uso durante más
 * de dos horas se cerraba igual, aunque el cliente siguiera mandando latidos. La tabla no guardaba en
 * ningún sitio cuándo fue el último: el latido escribía acciones, observaciones y auditoría, pero nada
 * en la propia sesión, así que el job no tenía con qué comparar.
 *
 * ## Lo que se añade
 *
 * - `last_activity_at TIMESTAMPTZ NULL`. Lo escribe el latido con la hora del SERVIDOR (no la
 *   `capturedAt` del cliente, que un reloj mal puesto o manipulado podría adelantar para no caducar).
 * - El job caduca por `COALESCE(last_activity_at, started_at)`: una sesión sin latidos se comporta
 *   exactamente como antes.
 *
 * Sin `UPDATE` ni valor por omisión: las filas anteriores quedan en NULL, que se lee «sin latido» —y
 * es verdad—. `ADD COLUMN` sin DEFAULT en PostgreSQL es sólo de catálogo: no reescribe la tabla.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${SESSIONS}
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
`);

  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${SESSIONS}.last_activity_at IS
     'Hora del servidor del último latido de la sesión. NULL = la sesión no ha mandado ninguno. expire_stale_sessions caduca por COALESCE(last_activity_at, started_at).'`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${SESSIONS}
  DROP COLUMN IF EXISTS last_activity_at;
`);
}
