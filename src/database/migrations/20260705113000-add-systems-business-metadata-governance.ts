import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

const attachUpdatedAtTrigger = (tableName: string) => `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${tableName}_set_updated_at') THEN
    CREATE TRIGGER ${tableName}_set_updated_at
      BEFORE UPDATE ON ${tableName}
      FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
  END IF;
END $$;
`;

async function addColumnIfMissing(queryInterface: QueryInterface, tableName: string, columnName: string, definition: string) {
  await queryInterface.sequelize.query(`
ALTER TABLE ${tableName}
ADD COLUMN IF NOT EXISTS ${columnName} ${definition};
`);
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'technical_purpose', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'business_value', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'audit_strategy', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'decision_use_cases', "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'input_payload_contract', "JSONB NOT NULL DEFAULT '{}'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'output_contract', "JSONB NOT NULL DEFAULT '{}'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'payload_origin_summary', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'side_effects_summary', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_catalog', 'metadata_completeness_score', 'INTEGER NOT NULL DEFAULT 0');

  await addColumnIfMissing(queryInterface, 'system_tool_catalog', 'description', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_tool_catalog', 'business_value', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_tool_catalog', 'technical_usage', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_tool_catalog', 'audit_notes', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_tool_catalog', 'failure_risks', 'TEXT');

  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'description', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'technical_purpose', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'business_process', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'why_store', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'who_uses', "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'audit_usage', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'analysis_usage', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'decision_usage', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'data_nature', "VARCHAR(60) NOT NULL DEFAULT 'OPERACIONAL'");
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'domain_code', 'VARCHAR(80)');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'data_grain', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'source_system', 'VARCHAR(120)');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'operational_rules_json', "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'quality_rules_json', "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'key_relationships_summary', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'relationship_rationale', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_data_entity_catalog', 'internationalization_notes', 'TEXT');

  await addColumnIfMissing(queryInterface, 'system_endpoint_data_entity_impacts', 'impact_reason', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_data_entity_impacts', 'impacted_fields_summary', 'TEXT');
  await addColumnIfMissing(
    queryInterface,
    'system_endpoint_data_entity_impacts',
    'payload_fields_json',
    "JSONB NOT NULL DEFAULT '[]'::jsonb",
  );
  await addColumnIfMissing(
    queryInterface,
    'system_endpoint_data_entity_impacts',
    'backend_generated_fields_json',
    "JSONB NOT NULL DEFAULT '[]'::jsonb",
  );
  await addColumnIfMissing(queryInterface, 'system_endpoint_data_entity_impacts', 'read_fields_json', "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await addColumnIfMissing(
    queryInterface,
    'system_endpoint_data_entity_impacts',
    'write_fields_json',
    "JSONB NOT NULL DEFAULT '[]'::jsonb",
  );

  await addColumnIfMissing(
    queryInterface,
    'system_endpoint_field_impacts',
    'data_source_kind',
    "VARCHAR(40) NOT NULL DEFAULT 'BACKEND_GENERATED'",
  );
  await addColumnIfMissing(queryInterface, 'system_endpoint_field_impacts', 'payload_path', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_field_impacts', 'backend_write_reason', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_field_impacts', 'business_meaning', 'TEXT');
  await addColumnIfMissing(queryInterface, 'system_endpoint_field_impacts', 'audit_usage', 'TEXT');

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_domain_catalog (
  _id BIGSERIAL PRIMARY KEY,
  domain_code VARCHAR(80) NOT NULL UNIQUE,
  domain_name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  business_definition TEXT NOT NULL,
  technical_scope TEXT NOT NULL,
  data_nature VARCHAR(60) NOT NULL,
  owner_team VARCHAR(120) NOT NULL,
  countries_applicable JSONB NOT NULL DEFAULT '[]'::jsonb,
  regulatory_notes TEXT,
  example_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_relevance TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_domain_catalog_status CHECK (status IN ('ACTIVE','PLANNED','DEPRECATED','DISABLED'))
);
CREATE INDEX IF NOT EXISTS ix_system_domain_catalog_nature ON system_domain_catalog(data_nature);
CREATE INDEX IF NOT EXISTS ix_system_domain_catalog_owner ON system_domain_catalog(owner_team);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_data_field_catalog (
  _id BIGSERIAL PRIMARY KEY,
  data_entity_id BIGINT REFERENCES system_data_entity_catalog(_id) ON DELETE CASCADE,
  schema_name VARCHAR(120) NOT NULL DEFAULT 'public',
  table_name VARCHAR(180) NOT NULL,
  column_name VARCHAR(180) NOT NULL,
  ordinal_position INTEGER,
  sql_data_type TEXT NOT NULL,
  is_nullable BOOLEAN NOT NULL DEFAULT TRUE,
  column_default TEXT,
  is_primary_key BOOLEAN NOT NULL DEFAULT FALSE,
  is_foreign_key BOOLEAN NOT NULL DEFAULT FALSE,
  referenced_schema VARCHAR(120),
  referenced_table VARCHAR(180),
  referenced_column VARCHAR(180),
  business_name VARCHAR(220) NOT NULL,
  business_meaning TEXT NOT NULL,
  technical_meaning TEXT NOT NULL,
  why_store TEXT NOT NULL,
  who_uses JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_usage TEXT NOT NULL,
  analysis_usage TEXT NOT NULL,
  decision_usage TEXT NOT NULL,
  source_kind VARCHAR(40) NOT NULL DEFAULT 'BACKEND_GENERATED',
  payload_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  backend_write_behavior TEXT NOT NULL,
  data_nature VARCHAR(60) NOT NULL DEFAULT 'OPERACIONAL',
  domain_code VARCHAR(80),
  governance_category VARCHAR(80) NOT NULL DEFAULT 'OPERACIONAL',
  classification_code VARCHAR(80),
  sensitivity_level VARCHAR(40) NOT NULL DEFAULT 'INTERNAL',
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
  source_document TEXT NOT NULL DEFAULT 'backend_schema',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_data_field_catalog_source_kind CHECK (source_kind IN ('PAYLOAD','PATH_PARAM','QUERY_PARAM','HEADER','BACKEND_GENERATED','DATABASE_READ','EXTERNAL_PROVIDER','COMPUTED','SYSTEM_CLOCK','CONFIGURATION')),
  CONSTRAINT ck_system_data_field_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_data_field_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_field_catalog_table_column ON system_data_field_catalog(schema_name, table_name, column_name);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_entity ON system_data_field_catalog(data_entity_id);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_domain ON system_data_field_catalog(domain_code);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_pii ON system_data_field_catalog(contains_pii);
CREATE INDEX IF NOT EXISTS ix_system_data_field_catalog_ml ON system_data_field_catalog(is_ml_candidate);
`);

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
  cardinality VARCHAR(40) NOT NULL,
  optionality VARCHAR(60) NOT NULL DEFAULT 'REQUIRED_WHEN_FLOW_REACHES_STEP',
  business_reason TEXT NOT NULL,
  technical_reason TEXT NOT NULL,
  audit_usage TEXT NOT NULL,
  analysis_usage TEXT NOT NULL,
  decision_usage TEXT NOT NULL,
  enforcement_strategy VARCHAR(80) NOT NULL DEFAULT 'FOREIGN_KEY_OR_LOGICAL_VALIDATION',
  delete_policy VARCHAR(80) NOT NULL DEFAULT 'RESTRICT_OR_SOFT_DELETE',
  source_document TEXT NOT NULL DEFAULT 'schema_relationships',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_data_relationship_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_data_relationship_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_relationship_catalog_unique ON system_data_relationship_catalog(source_schema, source_table, COALESCE(source_column, ''), target_schema, target_table, COALESCE(target_column, ''), relationship_type);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_source ON system_data_relationship_catalog(source_table);
CREATE INDEX IF NOT EXISTS ix_system_data_relationship_catalog_target ON system_data_relationship_catalog(target_table);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_operational_rule_catalog (
  _id BIGSERIAL PRIMARY KEY,
  rule_code VARCHAR(180) NOT NULL UNIQUE,
  scope_type VARCHAR(40) NOT NULL,
  schema_name VARCHAR(120) NOT NULL DEFAULT 'public',
  table_name VARCHAR(180),
  column_name VARCHAR(180),
  endpoint_code VARCHAR(180),
  domain_code VARCHAR(80),
  rule_type VARCHAR(60) NOT NULL,
  rule_name VARCHAR(220) NOT NULL,
  description TEXT NOT NULL,
  business_reason TEXT NOT NULL,
  technical_enforcement TEXT NOT NULL,
  enforcement_layer VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  expected_action TEXT NOT NULL,
  audit_evidence TEXT NOT NULL,
  analysis_value TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_document TEXT NOT NULL DEFAULT 'backend_schema',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_operational_rule_scope CHECK (scope_type IN ('TABLE','FIELD','ENDPOINT','DOMAIN','CATALOG')),
  CONSTRAINT ck_system_operational_rule_type CHECK (rule_type IN ('VALIDATION','LIFECYCLE','PRIVACY','AUDIT','QUALITY','RISK','FRAUD','CAPACITY','RETENTION','SECURITY','PERFORMANCE','INTEGRATION')),
  CONSTRAINT ck_system_operational_rule_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_system_operational_rule_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_operational_rule_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_table ON system_operational_rule_catalog(table_name);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_endpoint ON system_operational_rule_catalog(endpoint_code);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_domain ON system_operational_rule_catalog(domain_code);
CREATE INDEX IF NOT EXISTS ix_system_operational_rule_type ON system_operational_rule_catalog(rule_type);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_payload_contracts (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  contract_type VARCHAR(40) NOT NULL,
  schema_reference VARCHAR(180),
  dto_reference VARCHAR(180),
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_reason TEXT NOT NULL,
  validation_layer VARCHAR(80) NOT NULL DEFAULT 'ZOD_VALIDATION_PIPE',
  source_file TEXT,
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_payload_contracts_type CHECK (contract_type IN ('BODY','QUERY','PATH','HEADER','RESPONSE')),
  CONSTRAINT ck_system_endpoint_payload_contracts_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_payload_contracts_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_payload_contracts_endpoint_type_schema ON system_endpoint_payload_contracts(endpoint_id, contract_type, COALESCE(schema_reference, ''));
CREATE INDEX IF NOT EXISTS ix_system_endpoint_payload_contracts_endpoint ON system_endpoint_payload_contracts(endpoint_id);
`);

  for (const tableName of [
    'system_domain_catalog',
    'system_data_field_catalog',
    'system_data_relationship_catalog',
    'system_operational_rule_catalog',
    'system_endpoint_payload_contracts',
  ]) {
    await queryInterface.sequelize.query(attachUpdatedAtTrigger(tableName));
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_endpoint_payload_contracts;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_operational_rule_catalog;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_data_relationship_catalog;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_data_field_catalog;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_domain_catalog;');
}
