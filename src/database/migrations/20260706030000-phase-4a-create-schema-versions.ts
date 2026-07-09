import { QueryInterface } from 'sequelize';

/**
 * Fase 4A (Opción C - Híbrido): Schema Management para datacenter
 *
 * Esta migración crea la tabla base `schema_versions`, que registra cada versión del schema
 * (v1.0 = hoy, v1.1 = con nuevas tablas de catálogo, etc.). Es el punto de entrada para toda
 * la cadena de versionamiento: schema_tables → schema_columns → schema_relationships dependen
 * todas de una versión específica en esta tabla.
 *
 * APPEND-ONLY: nunca se edita una versión existente. Crear v1.1 es "INSERT", no "UPDATE v1.0".
 * AUDITORÍA: created_by_platform_user_id registra quién, created_at registra cuándo.
 * ROLLBACK: parent_version_id forma una cadena que permite revert a versión anterior.
 */

type MigrationContext = {
  context: QueryInterface;
};

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      _id BIGSERIAL PRIMARY KEY,
      version_code VARCHAR(30) NOT NULL UNIQUE,
      created_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      parent_version_id BIGINT REFERENCES schema_versions(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_schema_versions_code
    ON schema_versions(version_code);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_versions_active
    ON schema_versions(is_active) WHERE is_active = true;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_versions_parent
    ON schema_versions(parent_version_id) WHERE parent_version_id IS NOT NULL;
  `);

  // Insertar versión inicial v1.0 (el schema actual con las 121 tablas del proyecto)
  await queryInterface.sequelize.query(`
    INSERT INTO schema_versions (version_code, notes, is_active, _created_at)
    VALUES ('v1.0', 'Initial schema: 121 tables, BNPL + KYC + Risk + Fraud + Audit', true, NOW())
    ON CONFLICT (version_code) DO NOTHING;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS idx_schema_versions_parent;
  `);

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS idx_schema_versions_active;
  `);

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS ux_schema_versions_code;
  `);

  await queryInterface.sequelize.query(`
    DROP TABLE IF EXISTS schema_versions;
  `);
}
