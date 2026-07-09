import { QueryInterface } from 'sequelize';

/**
 * schema_tables: registra CADA tabla que existe en cada versión del schema.
 * Permite una visión completa y auditada de qué tablas existen, su tipo (transactional, catalog, etc.),
 * y atributos (append_only, tenant_scoped, etc.) que afectan cómo se actualiza/audita cada una.
 */

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_tables (
      _id BIGSERIAL PRIMARY KEY,
      schema_version_id BIGINT NOT NULL REFERENCES schema_versions(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      table_name VARCHAR(120) NOT NULL,
      table_type VARCHAR(40) NOT NULL DEFAULT 'transactional',  -- 'transactional', 'catalog', 'audit', 'operational'
      is_append_only BOOLEAN NOT NULL DEFAULT false,
      is_tenant_scoped BOOLEAN NOT NULL DEFAULT true,
      description TEXT,
      created_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_schema_tables_version_table_active
    ON schema_tables(schema_version_id, table_name) WHERE is_deleted = false;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_tables_version
    ON schema_tables(schema_version_id) WHERE is_deleted = false;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_tables_type
    ON schema_tables(table_type);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_tables_append_only
    ON schema_tables(is_append_only) WHERE is_append_only = true;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_tables_append_only;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_tables_type;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_tables_version;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ux_schema_tables_version_table_active;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS schema_tables;`);
}
