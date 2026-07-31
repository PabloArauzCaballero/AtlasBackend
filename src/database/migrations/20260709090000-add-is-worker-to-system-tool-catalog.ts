/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
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
