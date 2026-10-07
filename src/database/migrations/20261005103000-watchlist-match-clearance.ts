/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Descartar una coincidencia con una lista restrictiva deja de borrar la evidencia AML: queda quién, cuándo y por qué.
 * @system `watchlist_matches` gana `cleared_at`, `cleared_by_internal_user_id` y `cleared_reason_code`; las lecturas que bloquean miran sólo las no descartadas.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const ESQUEMA = atlasSchemaFor('watchlist_matches');
const TABLA = `${ESQUEMA}.watchlist_matches`;

/**
 * Antes, descartar era `DELETE`: se perdía la coincidencia y el siguiente screening la volvía a crear,
 * devolviendo al cliente a `under_review`. Ahora la fila se queda, marcada como descartada; el
 * screening la reconoce y no la repite.
 *
 * Sólo añade columnas nulables: ninguna fila existente cambia de significado (todas siguen abiertas).
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLA}
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cleared_by_internal_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS cleared_reason_code VARCHAR(80);

CREATE INDEX IF NOT EXISTS ix_watchlist_matches_customer_open
  ON ${TABLA} (_tenant_id, customer_id)
  WHERE cleared_at IS NULL;
`);
}

/**
 * Bajar quitaría la marca de descarte y todas esas coincidencias volverían a bloquear a su cliente. Si
 * ya hay descartes, se aborta: revertir en silencio reabriría decisiones de cumplimiento ya tomadas.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE cleared_at IS NOT NULL`);
  const descartadas = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  if (descartadas > 0) {
    throw new Error(
      `No se puede revertir: ${descartadas} coincidencia(s) ya están descartadas por cumplimiento. ` +
        'Revertir las volvería a dejar abiertas; expórtalas y resuélvelas antes de bajar esta migración.',
    );
  }
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${ESQUEMA}.ix_watchlist_matches_customer_open;
ALTER TABLE ${TABLA}
  DROP COLUMN IF EXISTS cleared_reason_code,
  DROP COLUMN IF EXISTS cleared_by_internal_user_id,
  DROP COLUMN IF EXISTS cleared_at;
`);
}
