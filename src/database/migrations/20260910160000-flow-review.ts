/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que una persona confirme o rechace lo que el análisis dedujo de un flujo.
 * @system añade al catálogo de flujos el estado de revisión humana, quién la hizo y sobre qué código.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('system_flow_catalog');
const FLOWS = `${SCHEMA}.system_flow_catalog`;

/**
 * El permiso `systems.flows.review` estaba sembrado y ningún endpoint lo usaba: nada de lo que el
 * análisis deduce de un flujo lo confirmaba una persona.
 *
 * `reviewed_deps_hash` guarda la huella del código que se revisó. Aprobar un flujo es aprobar ESE
 * código: si cambia, la aprobación ya no dice nada del nuevo y el flujo vuelve a la cola. Sin la
 * huella, una aprobación antigua seguiría pareciendo vigente, que es otro verde que responde a otra
 * pregunta.
 *
 * El valor por defecto vive en la base y NO en el modelo, a propósito: la recarga del catálogo hace
 * `upsert`, y un default del modelo viajaría en cada fila y pisaría las decisiones ya tomadas.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'AUTO_DETECTED',
  ADD COLUMN IF NOT EXISTS review_confidence VARCHAR(10),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reviewed_deps_hash VARCHAR(32);
CREATE INDEX IF NOT EXISTS ix_system_flow_catalog_review_status ON ${FLOWS} (review_status);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${SCHEMA}.ix_system_flow_catalog_review_status;
ALTER TABLE ${FLOWS}
  DROP COLUMN IF EXISTS reviewed_deps_hash,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS review_confidence,
  DROP COLUMN IF EXISTS review_status;
`);
}
