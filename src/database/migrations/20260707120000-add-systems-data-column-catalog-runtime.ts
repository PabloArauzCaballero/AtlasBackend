import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_data_field_catalog
  ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS detected_from VARCHAR(80) NOT NULL DEFAULT 'information_schema_enriched',
  ADD COLUMN IF NOT EXISTS references_entity_id BIGINT REFERENCES system_data_entity_catalog(_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS system_purpose TEXT,
  ADD COLUMN IF NOT EXISTS business_purpose TEXT,
  ADD COLUMN IF NOT EXISTS pii_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contains_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS used_in_scoring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS used_in_ml BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allowed_values JSONB,
  ADD COLUMN IF NOT EXISTS manually_edited_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_system_data_field_catalog_status'
  ) THEN
    ALTER TABLE system_data_field_catalog
      ADD CONSTRAINT ck_system_data_field_catalog_status
      CHECK (status IN ('ACTIVE','DEPRECATED_CANDIDATE','DEPRECATED','DISABLED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_status
  ON system_data_field_catalog(status);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_review
  ON system_data_field_catalog(review_status);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_system_data_field_catalog_review;
DROP INDEX IF EXISTS ix_system_data_field_catalog_status;
ALTER TABLE system_data_field_catalog
  DROP CONSTRAINT IF EXISTS ck_system_data_field_catalog_status,
  DROP COLUMN IF EXISTS manually_edited_at,
  DROP COLUMN IF EXISTS allowed_values,
  DROP COLUMN IF EXISTS used_in_ml,
  DROP COLUMN IF EXISTS used_in_scoring,
  DROP COLUMN IF EXISTS contains_sensitive,
  DROP COLUMN IF EXISTS pii_type,
  DROP COLUMN IF EXISTS business_purpose,
  DROP COLUMN IF EXISTS system_purpose,
  DROP COLUMN IF EXISTS references_entity_id,
  DROP COLUMN IF EXISTS detected_from,
  DROP COLUMN IF EXISTS status;
`);
}
