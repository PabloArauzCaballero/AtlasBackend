import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

const createUpdatedAtTrigger = `
CREATE OR REPLACE FUNCTION atlas_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW._updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;

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

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(createUpdatedAtTrigger);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_catalog (
  _id BIGSERIAL PRIMARY KEY,
  code VARCHAR(180) NOT NULL UNIQUE,
  module VARCHAR(120) NOT NULL,
  controller_name VARCHAR(180),
  handler_name VARCHAR(180),
  method VARCHAR(12) NOT NULL,
  route_path TEXT NOT NULL,
  full_path TEXT NOT NULL,
  route_name VARCHAR(220) NOT NULL,
  business_purpose TEXT NOT NULL,
  business_action TEXT,
  expected_response_summary TEXT,
  expected_status_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_payload_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  query_params_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  path_params_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_auth BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
  pii_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW',
  is_destructive BOOLEAN NOT NULL DEFAULT FALSE,
  is_readonly BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_required BOOLEAN NOT NULL DEFAULT FALSE,
  requires_stress_test BOOLEAN NOT NULL DEFAULT FALSE,
  requires_integration_test BOOLEAN NOT NULL DEFAULT FALSE,
  is_testable_from_portal BOOLEAN NOT NULL DEFAULT FALSE,
  test_environment_only BOOLEAN NOT NULL DEFAULT TRUE,
  owner_team VARCHAR(120) NOT NULL DEFAULT 'systems',
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  version VARCHAR(40) NOT NULL DEFAULT 'v1',
  detected_from VARCHAR(80) NOT NULL DEFAULT 'manual_seed',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW',
  source_file TEXT,
  created_by VARCHAR(80),
  updated_by VARCHAR(80),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_catalog_method CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')),
  CONSTRAINT ck_system_endpoint_catalog_risk CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_system_endpoint_catalog_status CHECK (status IN ('DRAFT','ACTIVE','DEPRECATED','BLOCKED','DEPRECATED_CANDIDATE')),
  CONSTRAINT ck_system_endpoint_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_catalog_method_full_path ON system_endpoint_catalog(method, full_path);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_module ON system_endpoint_catalog(module);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_status ON system_endpoint_catalog(status);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_risk ON system_endpoint_catalog(risk_level);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_stress ON system_endpoint_catalog(requires_stress_test);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_review ON system_endpoint_catalog(review_status);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_tool_catalog (
  _id BIGSERIAL PRIMARY KEY,
  code VARCHAR(160) NOT NULL UNIQUE,
  name VARCHAR(220) NOT NULL,
  type VARCHAR(80) NOT NULL,
  provider VARCHAR(160),
  purpose TEXT NOT NULL,
  required_env_vars JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  healthcheck_route TEXT,
  requires_credentials BOOLEAN NOT NULL DEFAULT FALSE,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  owner_team VARCHAR(120) NOT NULL DEFAULT 'systems',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_tool_catalog_status CHECK (status IN ('ACTIVE','PLANNED','DEPRECATED','DISABLED'))
);
CREATE INDEX IF NOT EXISTS ix_system_tool_catalog_type ON system_tool_catalog(type);
CREATE INDEX IF NOT EXISTS ix_system_tool_catalog_status ON system_tool_catalog(status);
CREATE INDEX IF NOT EXISTS ix_system_tool_catalog_critical ON system_tool_catalog(is_critical);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_data_entity_catalog (
  _id BIGSERIAL PRIMARY KEY,
  schema_name VARCHAR(120) NOT NULL DEFAULT 'public',
  table_name VARCHAR(180) NOT NULL,
  model_name VARCHAR(180),
  entity_name VARCHAR(220) NOT NULL,
  module VARCHAR(120) NOT NULL,
  business_purpose TEXT NOT NULL,
  data_owner VARCHAR(120) NOT NULL DEFAULT 'systems',
  contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
  contains_financial_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_risk_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_legal_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_device_data BOOLEAN NOT NULL DEFAULT FALSE,
  contains_location_data BOOLEAN NOT NULL DEFAULT FALSE,
  is_audit_critical BOOLEAN NOT NULL DEFAULT FALSE,
  retention_policy_code VARCHAR(120),
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  detected_from VARCHAR(80) NOT NULL DEFAULT 'model_scan',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  review_status VARCHAR(40) NOT NULL DEFAULT 'AUTO_DETECTED',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_data_entity_catalog_status CHECK (status IN ('ACTIVE','PLANNED','DEPRECATED','DISABLED')),
  CONSTRAINT ck_system_data_entity_catalog_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_data_entity_catalog_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_entity_catalog_schema_table ON system_data_entity_catalog(schema_name, table_name);
CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_module ON system_data_entity_catalog(module);
CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_pii ON system_data_entity_catalog(contains_pii);
CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_risk ON system_data_entity_catalog(contains_risk_data);
CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_audit ON system_data_entity_catalog(is_audit_critical);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_tool_requirements (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES system_tool_catalog(_id) ON DELETE CASCADE,
  usage_type VARCHAR(60) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  failure_impact VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  fallback_strategy TEXT,
  requires_mock BOOLEAN NOT NULL DEFAULT FALSE,
  requires_stress_test BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  detected_from VARCHAR(80) NOT NULL DEFAULT 'manual_seed',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_tool_requirements_impact CHECK (failure_impact IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_system_endpoint_tool_requirements_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_tool_requirements_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_tool_requirements_endpoint_tool_usage ON system_endpoint_tool_requirements(endpoint_id, tool_id, usage_type);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_tool_requirements_endpoint ON system_endpoint_tool_requirements(endpoint_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_tool_requirements_tool ON system_endpoint_tool_requirements(tool_id);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_data_entity_impacts (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  data_entity_id BIGINT NOT NULL REFERENCES system_data_entity_catalog(_id) ON DELETE CASCADE,
  operation_type VARCHAR(40) NOT NULL,
  impact_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  is_primary_entity BOOLEAN NOT NULL DEFAULT FALSE,
  is_transactional BOOLEAN NOT NULL DEFAULT FALSE,
  rollback_required BOOLEAN NOT NULL DEFAULT FALSE,
  affects_customer_state BOOLEAN NOT NULL DEFAULT FALSE,
  affects_financial_state BOOLEAN NOT NULL DEFAULT FALSE,
  affects_risk_state BOOLEAN NOT NULL DEFAULT FALSE,
  affects_legal_state BOOLEAN NOT NULL DEFAULT FALSE,
  affects_device_state BOOLEAN NOT NULL DEFAULT FALSE,
  affects_notification_state BOOLEAN NOT NULL DEFAULT FALSE,
  requires_audit_log BOOLEAN NOT NULL DEFAULT TRUE,
  requires_regression_test BOOLEAN NOT NULL DEFAULT FALSE,
  requires_stress_test BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  detected_from VARCHAR(80) NOT NULL DEFAULT 'docs',
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_data_entity_impacts_operation CHECK (operation_type IN ('READ','INSERT','UPDATE','DELETE','SOFT_DELETE','UPSERT','AGGREGATE','QUEUE','OUTBOX')),
  CONSTRAINT ck_system_endpoint_data_entity_impacts_level CHECK (impact_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_system_endpoint_data_entity_impacts_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_data_entity_impacts_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_data_entity_impacts_endpoint_entity_operation ON system_endpoint_data_entity_impacts(endpoint_id, data_entity_id, operation_type);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_data_entity_impacts_endpoint ON system_endpoint_data_entity_impacts(endpoint_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_data_entity_impacts_entity ON system_endpoint_data_entity_impacts(data_entity_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_data_entity_impacts_review ON system_endpoint_data_entity_impacts(review_status);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_endpoint_field_impacts (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  data_entity_id BIGINT NOT NULL REFERENCES system_data_entity_catalog(_id) ON DELETE CASCADE,
  field_name VARCHAR(180) NOT NULL,
  field_operation VARCHAR(40) NOT NULL,
  is_required_input BOOLEAN NOT NULL DEFAULT FALSE,
  is_generated BOOLEAN NOT NULL DEFAULT FALSE,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  is_ml_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  ml_feature_group VARCHAR(120),
  validation_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  confidence_level VARCHAR(20) NOT NULL DEFAULT 'LOW',
  review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW',
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_endpoint_field_impacts_operation CHECK (field_operation IN ('READ','WRITE','COMPUTE','MASK','VALIDATE','HASH','ENCRYPT')),
  CONSTRAINT ck_system_endpoint_field_impacts_confidence CHECK (confidence_level IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT ck_system_endpoint_field_impacts_review CHECK (review_status IN ('AUTO_DETECTED','NEEDS_REVIEW','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_field_impacts_endpoint_entity_field_operation ON system_endpoint_field_impacts(endpoint_id, data_entity_id, field_name, field_operation);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_field_impacts_endpoint ON system_endpoint_field_impacts(endpoint_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_field_impacts_entity ON system_endpoint_field_impacts(data_entity_id);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_field_impacts_ml ON system_endpoint_field_impacts(is_ml_candidate);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_test_suites (
  _id BIGSERIAL PRIMARY KEY,
  code VARCHAR(180) NOT NULL UNIQUE,
  name VARCHAR(220) NOT NULL,
  description TEXT,
  module VARCHAR(120) NOT NULL,
  suite_type VARCHAR(40) NOT NULL,
  execution_mode VARCHAR(40) NOT NULL DEFAULT 'SYNC_OR_JOB',
  environment_scope JSONB NOT NULL DEFAULT '["local","staging"]'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_seed_data BOOLEAN NOT NULL DEFAULT TRUE,
  is_safe_for_production BOOLEAN NOT NULL DEFAULT FALSE,
  requires_destructive_permission BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(80),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_test_suites_type CHECK (suite_type IN ('SMOKE','INTEGRATION','REGRESSION','E2E_API','LOAD')),
  CONSTRAINT ck_system_test_suites_execution_mode CHECK (execution_mode IN ('SYNC','DB_JOB','BULLMQ_PLANNED','SYNC_OR_JOB'))
);
CREATE INDEX IF NOT EXISTS ix_system_test_suites_module ON system_test_suites(module);
CREATE INDEX IF NOT EXISTS ix_system_test_suites_type ON system_test_suites(suite_type);
CREATE INDEX IF NOT EXISTS ix_system_test_suites_enabled ON system_test_suites(is_enabled);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_test_steps (
  _id BIGSERIAL PRIMARY KEY,
  suite_id BIGINT NOT NULL REFERENCES system_test_suites(_id) ON DELETE CASCADE,
  endpoint_id BIGINT REFERENCES system_endpoint_catalog(_id) ON DELETE SET NULL,
  step_order INTEGER NOT NULL,
  name VARCHAR(220) NOT NULL,
  input_mode VARCHAR(40) NOT NULL,
  method VARCHAR(12) NOT NULL,
  path_template TEXT NOT NULL,
  default_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  extractors JSONB NOT NULL DEFAULT '{}'::jsonb,
  assertions JSONB NOT NULL DEFAULT '{}'::jsonb,
  continue_on_failure BOOLEAN NOT NULL DEFAULT FALSE,
  cleanup_required BOOLEAN NOT NULL DEFAULT FALSE,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_test_steps_input_mode CHECK (input_mode IN ('DEFAULT','CONFIGURABLE','GENERATED','FROM_PREVIOUS_STEP')),
  CONSTRAINT ck_system_test_steps_method CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_test_steps_suite_order ON system_test_steps(suite_id, step_order);
CREATE INDEX IF NOT EXISTS ix_system_test_steps_endpoint ON system_test_steps(endpoint_id);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_test_runs (
  _id BIGSERIAL PRIMARY KEY,
  suite_id BIGINT NOT NULL REFERENCES system_test_suites(_id) ON DELETE CASCADE,
  environment VARCHAR(40) NOT NULL,
  triggered_by VARCHAR(80),
  status VARCHAR(40) NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs_url TEXT,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_test_runs_environment CHECK (environment IN ('LOCAL','STAGING','PRODUCTION_READONLY')),
  CONSTRAINT ck_system_test_runs_status CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS ix_system_test_runs_suite ON system_test_runs(suite_id);
CREATE INDEX IF NOT EXISTS ix_system_test_runs_status ON system_test_runs(status);
CREATE INDEX IF NOT EXISTS ix_system_test_runs_created ON system_test_runs(_created_at DESC);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_test_step_runs (
  _id BIGSERIAL PRIMARY KEY,
  test_run_id BIGINT NOT NULL REFERENCES system_test_runs(_id) ON DELETE CASCADE,
  step_id BIGINT NOT NULL REFERENCES system_test_steps(_id) ON DELETE CASCADE,
  status VARCHAR(40) NOT NULL,
  request_payload_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_body_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_test_step_runs_status CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED','SKIPPED'))
);
CREATE INDEX IF NOT EXISTS ix_system_test_step_runs_run ON system_test_step_runs(test_run_id);
CREATE INDEX IF NOT EXISTS ix_system_test_step_runs_status ON system_test_step_runs(status);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_action_logs (
  _id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(120),
  correlation_id VARCHAR(120),
  endpoint_catalog_id BIGINT REFERENCES system_endpoint_catalog(_id) ON DELETE SET NULL,
  actor_user_id VARCHAR(80),
  actor_type VARCHAR(60),
  actor_role VARCHAR(80),
  actor_internal_user_id BIGINT,
  actor_platform_user_id BIGINT,
  method VARCHAR(12) NOT NULL,
  route_template TEXT,
  resolved_url_sanitized TEXT NOT NULL,
  module VARCHAR(120),
  action_name VARCHAR(180),
  ip_address INET,
  user_agent TEXT,
  target_type VARCHAR(120),
  target_id VARCHAR(120),
  merchant_id BIGINT,
  customer_id BIGINT,
  request_payload_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_payload_hash VARCHAR(128),
  response_status_code INTEGER,
  response_summary_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(120),
  error_message TEXT,
  duration_ms INTEGER,
  idempotency_key_hash VARCHAR(128),
  idempotency_key_last4 VARCHAR(8),
  risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW',
  contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_action_logs_risk CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_request ON system_action_logs(request_id);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_correlation ON system_action_logs(correlation_id);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_endpoint ON system_action_logs(endpoint_catalog_id);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_method_url ON system_action_logs(method, resolved_url_sanitized);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_actor ON system_action_logs(actor_type, actor_user_id);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_status ON system_action_logs(response_status_code);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_occurred ON system_action_logs(occurred_at DESC);
`);

  for (const tableName of [
    'system_endpoint_catalog',
    'system_tool_catalog',
    'system_data_entity_catalog',
    'system_endpoint_tool_requirements',
    'system_endpoint_data_entity_impacts',
    'system_endpoint_field_impacts',
    'system_test_suites',
    'system_test_steps',
    'system_test_runs',
  ]) {
    await queryInterface.sequelize.query(attachUpdatedAtTrigger(tableName));
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_action_logs;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_test_step_runs;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_test_runs;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_test_steps;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_test_suites;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_endpoint_field_impacts;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_endpoint_data_entity_impacts;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_endpoint_tool_requirements;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_data_entity_catalog;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_tool_catalog;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_endpoint_catalog;');
}
