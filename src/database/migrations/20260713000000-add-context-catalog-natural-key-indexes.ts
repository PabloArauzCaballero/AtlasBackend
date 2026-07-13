import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Índices únicos parciales requeridos para poder hacer upsert por clave natural
 * (`ON CONFLICT (...) WHERE ...`) al inyectar el paquete de seeds de contexto
 * multidominio. Sin estos índices, `context_catalog_versions`, `context_items`,
 * `context_item_aliases` y `context_risk_mappings` solo tienen índices no-únicos
 * (ver `20260626154059-schema-relationships-part-5-catalog-context.ts`), así que
 * Postgres no tiene forma de detectar conflictos por clave natural.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_context_catalog_versions_catalog_version
  ON public.context_catalog_versions (catalog_id, version_code)
  WHERE catalog_id IS NOT NULL AND version_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_context_items_catalog_version_item_code
  ON public.context_items (catalog_version_id, item_code)
  WHERE catalog_version_id IS NOT NULL AND item_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_context_item_aliases_item_alias_type
  ON public.context_item_aliases (context_item_id, normalized_alias, alias_type)
  WHERE context_item_id IS NOT NULL AND normalized_alias IS NOT NULL AND alias_type IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_context_risk_mappings_natural_key
  ON public.context_risk_mappings (context_item_id, risk_dimension, risk_band, reason_code, valid_from)
  WHERE context_item_id IS NOT NULL AND risk_dimension IS NOT NULL AND risk_band IS NOT NULL AND reason_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_context_items_active_catalog_lookup
  ON public.context_items (catalog_version_id, is_active, item_code);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_context_items_active_catalog_lookup;
DROP INDEX IF EXISTS ux_context_risk_mappings_natural_key;
DROP INDEX IF EXISTS ux_context_item_aliases_item_alias_type;
DROP INDEX IF EXISTS ux_context_items_catalog_version_item_code;
DROP INDEX IF EXISTS ux_context_catalog_versions_catalog_version;
`);
}
