import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // ── Extend system_endpoint_catalog with missing columns ──────────────────
  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_catalog
  ADD COLUMN IF NOT EXISTS technical_purpose TEXT,
  ADD COLUMN IF NOT EXISTS business_value TEXT,
  ADD COLUMN IF NOT EXISTS audit_strategy TEXT,
  ADD COLUMN IF NOT EXISTS decision_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS input_payload_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payload_origin_summary TEXT,
  ADD COLUMN IF NOT EXISTS side_effects_summary TEXT,
  ADD COLUMN IF NOT EXISTS metadata_completeness_score INTEGER NOT NULL DEFAULT 0;
`);

  // ── Extend system_data_entity_catalog with missing columns ───────────────
  await queryInterface.sequelize.query(`
ALTER TABLE system_data_entity_catalog
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS technical_purpose TEXT,
  ADD COLUMN IF NOT EXISTS business_process TEXT,
  ADD COLUMN IF NOT EXISTS why_store TEXT,
  ADD COLUMN IF NOT EXISTS who_uses JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_usage TEXT,
  ADD COLUMN IF NOT EXISTS analysis_usage TEXT,
  ADD COLUMN IF NOT EXISTS decision_usage TEXT,
  ADD COLUMN IF NOT EXISTS data_nature VARCHAR(60),
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS data_grain TEXT,
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(120),
  ADD COLUMN IF NOT EXISTS operational_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS key_relationships_summary TEXT,
  ADD COLUMN IF NOT EXISTS relationship_rationale TEXT,
  ADD COLUMN IF NOT EXISTS internationalization_notes TEXT;
`);

  // ── system_domain_catalog ─────────────────────────────────────────────────
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_domain_catalog (
  _id BIGSERIAL PRIMARY KEY,
  domain_code VARCHAR(120) NOT NULL UNIQUE,
  domain_name VARCHAR(220) NOT NULL,
  description TEXT NOT NULL,
  business_definition TEXT NOT NULL,
  technical_scope TEXT NOT NULL,
  data_nature VARCHAR(60) NOT NULL DEFAULT 'OPERACIONAL',
  owner_team VARCHAR(120) NOT NULL DEFAULT 'systems-governance',
  countries_applicable JSONB NOT NULL DEFAULT '["BOL"]'::jsonb,
  regulatory_notes TEXT,
  example_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_relevance TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_domain_catalog_status CHECK (status IN ('ACTIVE','DEPRECATED','PLANNED'))
);
CREATE INDEX IF NOT EXISTS ix_system_domain_catalog_status ON system_domain_catalog(status);
`);

  // ── system_endpoint_payload_contracts ────────────────────────────────────
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_payload_contracts (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  contract_type VARCHAR(20) NOT NULL,
  schema_reference VARCHAR(180),
  dto_reference VARCHAR(180),
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_reason TEXT,
  validation_layer VARCHAR(80) NOT NULL DEFAULT 'ZOD_VALIDATION_PIPE',
  source_file TEXT,
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_payload_contracts_type CHECK (contract_type IN ('BODY','QUERY','PATH','HEADER','RESPONSE')),
  CONSTRAINT ck_system_endpoint_payload_contracts_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_payload_contracts_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED','INFERRED_FROM_ROUTE_REVIEW_REQUIRED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_payload_contracts_endpoint_type_ref
  ON system_endpoint_payload_contracts(endpoint_id, contract_type, COALESCE(schema_reference, ''));
CREATE INDEX IF NOT EXISTS ix_system_endpoint_payload_contracts_endpoint ON system_endpoint_payload_contracts(endpoint_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_payload_contracts_review ON system_endpoint_payload_contracts(review_status);
`);

  // ── system_data_field_catalog ─────────────────────────────────────────────
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_data_field_catalog (
  _id BIGSERIAL PRIMARY KEY,
  data_entity_id BIGINT REFERENCES system_data_entity_catalog(_id) ON DELETE SET NULL,
  schema_name VARCHAR(120) NOT NULL DEFAULT 'public',
  table_name VARCHAR(180) NOT NULL,
  column_name VARCHAR(180) NOT NULL,
  ordinal_position INTEGER,
  sql_data_type VARCHAR(120),
  is_nullable BOOLEAN NOT NULL DEFAULT TRUE,
  column_default TEXT,
  is_primary_key BOOLEAN NOT NULL DEFAULT FALSE,
  is_foreign_key BOOLEAN NOT NULL DEFAULT FALSE,
  referenced_schema VARCHAR(120),
  referenced_table VARCHAR(180),
  referenced_column VARCHAR(180),
  business_name VARCHAR(220),
  business_meaning TEXT,
  technical_meaning TEXT,
  why_store TEXT,
  who_uses JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_usage TEXT,
  analysis_usage TEXT,
  decision_usage TEXT,
  source_kind VARCHAR(80),
  payload_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  backend_write_behavior TEXT,
  data_nature VARCHAR(60),
  domain_code VARCHAR(120),
  governance_category VARCHAR(80),
  classification_code VARCHAR(120),
  sensitivity_level VARCHAR(40),
  contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
  contains_financial_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_risk_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_fraud_signal BOOLEAN NOT NULL DEFAULT FALSE,
  contains_capacity_signal BOOLEAN NOT NULL DEFAULT FALSE,
  is_ml_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  ml_feature_group VARCHAR(120),
  quality_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_policy_code VARCHAR(120),
  frontend_label VARCHAR(220),
  form_usage TEXT,
  relationship_notes TEXT,
  operational_notes TEXT,
  source_document VARCHAR(120) NOT NULL DEFAULT 'information_schema',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_data_field_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_data_field_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_field_catalog_schema_table_column
  ON system_data_field_catalog(schema_name, table_name, column_name);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_entity ON system_data_field_catalog(data_entity_id);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_table ON system_data_field_catalog(table_name);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_pii ON system_data_field_catalog(contains_pii);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_ml ON system_data_field_catalog(is_ml_candidate);
`);

  // ── system_data_relationship_catalog ────────────────────────────────────
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_data_relationship_catalog (
  _id BIGSERIAL PRIMARY KEY,
  source_data_entity_id BIGINT REFERENCES system_data_entity_catalog(_id) ON DELETE SET NULL,
  target_data_entity_id BIGINT REFERENCES system_data_entity_catalog(_id) ON DELETE SET NULL,
  source_schema VARCHAR(120) NOT NULL DEFAULT 'public',
  source_table VARCHAR(180) NOT NULL,
  source_column VARCHAR(180),
  target_schema VARCHAR(120) NOT NULL DEFAULT 'public',
  target_table VARCHAR(180) NOT NULL,
  target_column VARCHAR(180),
  relationship_type VARCHAR(80) NOT NULL,
  cardinality VARCHAR(20) NOT NULL DEFAULT 'N:1',
  optionality VARCHAR(60) NOT NULL DEFAULT 'REQUIRED_WHEN_FLOW_REACHES_STEP',
  business_reason TEXT,
  technical_reason TEXT,
  audit_usage TEXT,
  analysis_usage TEXT,
  decision_usage TEXT,
  enforcement_strategy VARCHAR(80),
  delete_policy VARCHAR(80),
  source_document VARCHAR(120) NOT NULL DEFAULT 'information_schema_fk',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_data_relationship_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_data_relationship_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_relationship_catalog_src_tgt_type
  ON system_data_relationship_catalog(source_schema, source_table, COALESCE(source_column, ''), target_schema, target_table, COALESCE(target_column, ''), relationship_type);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_source ON system_data_relationship_catalog(source_table);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_target ON system_data_relationship_catalog(target_table);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_source_entity ON system_data_relationship_catalog(source_data_entity_id);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_target_entity ON system_data_relationship_catalog(target_data_entity_id);
`);

  // ── system_operational_rule_catalog ─────────────────────────────────────
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_operational_rule_catalog (
  _id BIGSERIAL PRIMARY KEY,
  rule_code VARCHAR(180) NOT NULL UNIQUE,
  scope_type VARCHAR(40) NOT NULL DEFAULT 'TABLE',
  schema_name VARCHAR(120) NOT NULL DEFAULT 'public',
  table_name VARCHAR(180),
  domain_code VARCHAR(120),
  rule_type VARCHAR(40) NOT NULL,
  rule_name VARCHAR(220) NOT NULL,
  description TEXT NOT NULL,
  business_reason TEXT,
  technical_enforcement TEXT,
  enforcement_layer VARCHAR(120),
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  expected_action TEXT,
  audit_evidence TEXT,
  analysis_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_document VARCHAR(120) NOT NULL DEFAULT 'manual',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_operational_rule_catalog_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_system_operational_rule_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_operational_rule_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_catalog_table ON system_operational_rule_catalog(table_name);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_catalog_domain ON system_operational_rule_catalog(domain_code);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_catalog_type ON system_operational_rule_catalog(rule_type);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_catalog_severity ON system_operational_rule_catalog(severity);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_catalog_active ON system_operational_rule_catalog(is_active);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_operational_rule_catalog CASCADE;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_data_relationship_catalog CASCADE;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_data_field_catalog CASCADE;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_endpoint_payload_contracts CASCADE;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_domain_catalog CASCADE;`);

  await queryInterface.sequelize.query(`
ALTER TABLE system_data_entity_catalog
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS technical_purpose,
  DROP COLUMN IF EXISTS business_process,
  DROP COLUMN IF EXISTS why_store,
  DROP COLUMN IF EXISTS who_uses,
  DROP COLUMN IF EXISTS audit_usage,
  DROP COLUMN IF EXISTS analysis_usage,
  DROP COLUMN IF EXISTS decision_usage,
  DROP COLUMN IF EXISTS data_nature,
  DROP COLUMN IF EXISTS domain_code,
  DROP COLUMN IF EXISTS data_grain,
  DROP COLUMN IF EXISTS source_system,
  DROP COLUMN IF EXISTS operational_rules_json,
  DROP COLUMN IF EXISTS quality_rules_json,
  DROP COLUMN IF EXISTS key_relationships_summary,
  DROP COLUMN IF EXISTS relationship_rationale,
  DROP COLUMN IF EXISTS internationalization_notes;
`);

  await queryInterface.sequelize.query(`
ALTER TABLE system_endpoint_catalog
  DROP COLUMN IF EXISTS technical_purpose,
  DROP COLUMN IF EXISTS business_value,
  DROP COLUMN IF EXISTS audit_strategy,
  DROP COLUMN IF EXISTS decision_use_cases,
  DROP COLUMN IF EXISTS input_payload_contract,
  DROP COLUMN IF EXISTS output_contract,
  DROP COLUMN IF EXISTS payload_origin_summary,
  DROP COLUMN IF EXISTS side_effects_summary,
  DROP COLUMN IF EXISTS metadata_completeness_score;
`);
}
