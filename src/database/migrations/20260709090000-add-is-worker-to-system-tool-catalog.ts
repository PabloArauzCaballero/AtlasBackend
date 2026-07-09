import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_tool_catalog
  ADD COLUMN IF NOT EXISTS is_worker BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_system_tool_catalog_is_worker
  ON system_tool_catalog(is_worker)
  WHERE is_worker = TRUE;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_system_tool_catalog_is_worker;
ALTER TABLE system_tool_catalog
  DROP COLUMN IF EXISTS is_worker;
`);
}
