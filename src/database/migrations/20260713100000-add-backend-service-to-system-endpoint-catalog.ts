import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * El catálogo de endpoints deja de asumir un único backend: cada endpoint declara
 * de qué backend/servicio proviene (`backend_service`) y opcionalmente su base URL
 * (`backend_base_url`), para poder catalogar endpoints de otros backends además de
 * atlas-backend.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_catalog
  ADD COLUMN IF NOT EXISTS backend_service VARCHAR(120) NOT NULL DEFAULT 'atlas-backend',
  ADD COLUMN IF NOT EXISTS backend_base_url TEXT;

CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_backend_service
  ON system_endpoint_catalog(backend_service);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_system_endpoint_catalog_backend_service;
ALTER TABLE system_endpoint_catalog
  DROP COLUMN IF EXISTS backend_service,
  DROP COLUMN IF EXISTS backend_base_url;
`);
}
