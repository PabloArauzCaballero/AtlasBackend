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

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_stress_profiles (
  _id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES system_endpoint_catalog(_id) ON DELETE CASCADE,
  code VARCHAR(180) NOT NULL UNIQUE,
  name VARCHAR(220) NOT NULL,
  target_rps INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  concurrency INTEGER NOT NULL,
  environment_scope JSONB NOT NULL DEFAULT '["LOCAL","STAGING"]'::jsonb,
  max_error_rate DOUBLE PRECISION NOT NULL DEFAULT 0.01,
  max_p95_ms INTEGER NOT NULL DEFAULT 1000,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_by VARCHAR(80),
  updated_by VARCHAR(80),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_stress_profiles_status CHECK (status IN ('ACTIVE','DISABLED','NEEDS_REVIEW','DEPRECATED')),
  CONSTRAINT ck_system_stress_profiles_target_rps CHECK (target_rps BETWEEN 1 AND 10000),
  CONSTRAINT ck_system_stress_profiles_duration CHECK (duration_seconds BETWEEN 5 AND 86400),
  CONSTRAINT ck_system_stress_profiles_concurrency CHECK (concurrency BETWEEN 1 AND 5000),
  CONSTRAINT ck_system_stress_profiles_error_rate CHECK (max_error_rate >= 0 AND max_error_rate <= 1),
  CONSTRAINT ck_system_stress_profiles_p95 CHECK (max_p95_ms BETWEEN 1 AND 300000)
);
CREATE INDEX IF NOT EXISTS ix_system_stress_profiles_endpoint ON system_stress_profiles(endpoint_id);
CREATE INDEX IF NOT EXISTS ix_system_stress_profiles_status ON system_stress_profiles(status);
CREATE INDEX IF NOT EXISTS ix_system_stress_profiles_enabled ON system_stress_profiles(is_enabled);
`);

  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_system_action_logs_module ON system_action_logs(module);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_risk ON system_action_logs(risk_level);
CREATE INDEX IF NOT EXISTS ix_system_action_logs_contains_pii ON system_action_logs(contains_pii);
`);

  await queryInterface.sequelize.query(attachUpdatedAtTrigger('system_stress_profiles'));
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ix_system_action_logs_contains_pii;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ix_system_action_logs_risk;');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ix_system_action_logs_module;');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS system_stress_profiles;');
}
