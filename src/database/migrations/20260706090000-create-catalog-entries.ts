import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS catalog_entries (
      _id BIGSERIAL PRIMARY KEY,
      catalog_code VARCHAR(80) NOT NULL,
      catalog_version INTEGER NOT NULL,
      entry_code VARCHAR(120) NOT NULL,
      entry_name VARCHAR(220) NOT NULL,
      entry_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_immutable_after_use BOOLEAN NOT NULL DEFAULT false,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_by_version_id BIGINT REFERENCES catalog_entries(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMPTZ,
      CONSTRAINT ck_catalog_entries_usage_count_non_negative CHECK (usage_count >= 0)
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_entries_code_version_entry
    ON catalog_entries(catalog_code, catalog_version, entry_code);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_catalog_entries_code_version_active
    ON catalog_entries(catalog_code, catalog_version, is_active);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ix_catalog_entries_code_version_active;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_catalog_entries_code_version_entry;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS catalog_entries;');
}
