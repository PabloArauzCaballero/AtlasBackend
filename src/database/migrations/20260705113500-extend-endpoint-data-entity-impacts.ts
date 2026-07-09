import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // ── Extend system_endpoint_data_entity_impacts ───────────────────────────
  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_data_entity_impacts
  ADD COLUMN IF NOT EXISTS impact_reason TEXT,
  ADD COLUMN IF NOT EXISTS impacted_fields_summary TEXT,
  ADD COLUMN IF NOT EXISTS payload_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS backend_generated_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS read_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS write_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb;
`);

  // ── Extend system_endpoint_field_impacts ────────────────────────────────
  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_field_impacts
  ADD COLUMN IF NOT EXISTS data_source_kind VARCHAR(80),
  ADD COLUMN IF NOT EXISTS payload_path TEXT,
  ADD COLUMN IF NOT EXISTS backend_write_reason TEXT,
  ADD COLUMN IF NOT EXISTS business_meaning TEXT,
  ADD COLUMN IF NOT EXISTS audit_usage TEXT;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_field_impacts
  DROP COLUMN IF EXISTS data_source_kind,
  DROP COLUMN IF EXISTS payload_path,
  DROP COLUMN IF EXISTS backend_write_reason,
  DROP COLUMN IF EXISTS business_meaning,
  DROP COLUMN IF EXISTS audit_usage;
`);

  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_data_entity_impacts
  DROP COLUMN IF EXISTS impact_reason,
  DROP COLUMN IF EXISTS impacted_fields_summary,
  DROP COLUMN IF EXISTS payload_fields_json,
  DROP COLUMN IF EXISTS backend_generated_fields_json,
  DROP COLUMN IF EXISTS read_fields_json,
  DROP COLUMN IF EXISTS write_fields_json;
`);
}
