import { QueryInterface } from 'sequelize';

/**
 * schema_change_log: auditoría exhaustiva de CADA intento de cambio DDL.
 * Registra: qué se intentó cambiar, quién lo pidió, si fue aprobado, si falló, si se revirtió.
 * Es la "caja negra" de toda la evolución del schema.
 *
 * Workflow: crear entry en "pending" → humano aprueba → se ejecuta el cambio real →
 * entry pasa a "success" o "failed" → si se revierte, rolled_back=true.
 */

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_change_log (
      _id BIGSERIAL PRIMARY KEY,
      schema_version_id BIGINT REFERENCES schema_versions(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      change_type VARCHAR(30) NOT NULL,  -- 'CREATE_TABLE', 'ADD_COLUMN', 'MODIFY_INDEX', 'DROP_COLUMN'
      affected_entity_id BIGINT,         -- tabla, columna, o relationship ID
      affected_entity_type VARCHAR(30),  -- 'TABLE', 'COLUMN', 'RELATIONSHIP', 'INDEX'
      change_payload JSONB NOT NULL,     -- {tableName, columnName, ...} detalle del cambio
      requester_platform_user_id BIGINT NOT NULL REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
      approved_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      approved_at TIMESTAMP WITH TIME ZONE,
      rolled_back BOOLEAN NOT NULL DEFAULT false,
      rolled_back_at TIMESTAMP WITH TIME ZONE,
      rolled_back_by_platform_user_id BIGINT REFERENCES platform_users(_id) ON UPDATE CASCADE ON DELETE SET NULL,
      change_result VARCHAR(20),  -- 'pending', 'success', 'failed', 'rejected'
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      _updated_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_version
    ON schema_change_log(schema_version_id) WHERE schema_version_id IS NOT NULL;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_status
    ON schema_change_log(approval_status);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_requester
    ON schema_change_log(requester_platform_user_id);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_entity
    ON schema_change_log(affected_entity_type, affected_entity_id)
    WHERE affected_entity_id IS NOT NULL;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_rolled_back
    ON schema_change_log(rolled_back) WHERE rolled_back = true;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_change_log_created
    ON schema_change_log(created_at DESC);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_created;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_rolled_back;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_entity;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_requester;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_status;`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_schema_change_log_version;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS schema_change_log;`);
}
