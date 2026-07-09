import { QueryInterface } from 'sequelize';

/**
 * schema_columns: registra CADA columna de CADA tabla en cada versión.
 * Incluye metadatos críticos para auditoría: is_immutable (no se puede cambiar tras inserción),
 * is_pii (cifrado/hasheo requerido), is_indexed, etc.
 */

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_columns (
      _id BIGSERIAL PRIMARY KEY,
      schema_table_id BIGINT NOT NULL REFERENCES schema_tables(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      column_name VARCHAR(120) NOT NULL,
      column_type VARCHAR(60) NOT NULL,
      is_nullable BOOLEAN NOT NULL DEFAULT false,
      is_immutable BOOLEAN NOT NULL DEFAULT false,  -- NO se puede cambiar tras inserción
      is_pii BOOLEAN NOT NULL DEFAULT false,        -- cifrar/hashear requerido
      is_indexed BOOLEAN NOT NULL DEFAULT false,
      default_value TEXT,
      description TEXT,
      created_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_schema_columns_table_column_active
    ON schema_columns(schema_table_id, column_name) WHERE is_deleted = false;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_columns_table
    ON schema_columns(schema_table_id) WHERE is_deleted = false;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_columns_immutable
    ON schema_columns(is_immutable) WHERE is_immutable = true;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_columns_pii
    ON schema_columns(is_pii) WHERE is_pii = true;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_columns_pii;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_columns_immutable;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_columns_table;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ux_schema_columns_table_column_active;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS schema_columns;`);
}
