/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const ENTITY_CATALOG = `${atlasSchemaFor('system_data_entity_catalog')}.system_data_entity_catalog`;

/**
 * Narrativa de gobierno por entidad (tabla) del modelo de datos.
 *
 * Las columnas que ya existían (`business_purpose`, `why_store`, `decision_usage`,
 * `technical_purpose`) se llenaban con texto plantilla POR DOMINIO: las 15 tablas de riesgo
 * compartían literalmente la misma frase. Eso alcanza para clasificar, pero no para responder las
 * cuatro preguntas que un comité de datos hace antes de aprobar (o eliminar) una tabla:
 *
 *   1. ¿Por qué existe a nivel negocio?          -> business_why_exists
 *   2. ¿Por qué NO debería eliminarse?           -> business_why_not_delete
 *   3. ¿Qué aporta a la toma de decisiones?      -> business_decision_contribution
 *   4. ¿Un ejemplo concreto de uso?              -> business_usage_example
 *   5. ¿Cómo funciona a nivel sistemas?          -> systems_explanation
 *
 * Se agregan columnas nuevas en vez de reescribir las existentes para no romper a los consumidores
 * actuales (`portal-glossary.service.ts` lee `business_purpose`; el catálogo de campos hereda
 * `why_store`/`decision_usage`).
 *
 * `narrative_source` distingue el texto curado a mano (CURATED) del texto derivado por plantilla de
 * dominio (DOMAIN_TEMPLATE), para poder medir la deuda de documentación en vez de asumir que todo
 * fue revisado por una persona.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${ENTITY_CATALOG}
  ADD COLUMN IF NOT EXISTS business_why_exists TEXT,
  ADD COLUMN IF NOT EXISTS business_why_not_delete TEXT,
  ADD COLUMN IF NOT EXISTS business_decision_contribution TEXT,
  ADD COLUMN IF NOT EXISTS business_usage_example TEXT,
  ADD COLUMN IF NOT EXISTS systems_explanation TEXT,
  ADD COLUMN IF NOT EXISTS narrative_source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS narrative_updated_at TIMESTAMPTZ;
`);

  // Constraint separada de la creación de columnas: si la migración se reaplica sobre una base que
  // ya tenía las columnas, ADD COLUMN IF NOT EXISTS no repite la constraint y ADD CONSTRAINT sin
  // guarda fallaría. Postgres no soporta ADD CONSTRAINT IF NOT EXISTS para CHECK.
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_data_entity_catalog_narrative_source'
  ) THEN
    ALTER TABLE ${ENTITY_CATALOG}
      ADD CONSTRAINT ck_system_data_entity_catalog_narrative_source
      CHECK (narrative_source IS NULL OR narrative_source IN ('CURATED','DOMAIN_TEMPLATE'));
  END IF;
END
$$;
`);

  // Índice parcial: la consulta operativa real es "¿qué tablas siguen sin narrativa curada?".
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_narrative_source
  ON ${ENTITY_CATALOG}(narrative_source)
  WHERE narrative_source IS DISTINCT FROM 'CURATED';
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ix_system_data_entity_catalog_narrative_source;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${ENTITY_CATALOG}
  DROP CONSTRAINT IF EXISTS ck_system_data_entity_catalog_narrative_source;
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${ENTITY_CATALOG}
  DROP COLUMN IF EXISTS business_why_exists,
  DROP COLUMN IF EXISTS business_why_not_delete,
  DROP COLUMN IF EXISTS business_decision_contribution,
  DROP COLUMN IF EXISTS business_usage_example,
  DROP COLUMN IF EXISTS systems_explanation,
  DROP COLUMN IF EXISTS narrative_source,
  DROP COLUMN IF EXISTS narrative_updated_at;
`);
}
