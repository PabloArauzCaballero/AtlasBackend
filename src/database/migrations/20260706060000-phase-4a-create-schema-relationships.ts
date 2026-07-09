import { QueryInterface } from 'sequelize';

/**
 * schema_relationships: registra CADA FK (foreign key) en cada versión.
 * COMPLETAMENTE INMUTABLE una vez creada: una FK no se puede eliminar ni modificar.
 * Si alguien intenta, schema_change_log lo rechaza.
 * cascade_delete es una bandera de documentación (no una regla SQL que se ejecuta aquí).
 */

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_relationships (
      _id BIGSERIAL PRIMARY KEY,
      schema_version_id BIGINT NOT NULL REFERENCES schema_versions(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      source_table_id BIGINT NOT NULL REFERENCES schema_tables(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      source_column_name VARCHAR(120) NOT NULL,
      target_table_id BIGINT NOT NULL REFERENCES schema_tables(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      target_column_name VARCHAR(120) NOT NULL,
      cascade_delete BOOLEAN NOT NULL DEFAULT false,
      is_immutable BOOLEAN NOT NULL DEFAULT true,  -- SIEMPRE true para FK
      created_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(schema_version_id, source_table_id, target_table_id, source_column_name)
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_relationships_source
    ON schema_relationships(source_table_id);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_relationships_target
    ON schema_relationships(target_table_id);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_relationships_version
    ON schema_relationships(schema_version_id);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_relationships_version;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_relationships_target;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_relationships_source;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS schema_relationships;`);
}
