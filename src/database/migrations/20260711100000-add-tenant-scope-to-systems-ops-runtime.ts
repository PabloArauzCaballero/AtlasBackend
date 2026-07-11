import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_action_logs ADD COLUMN IF NOT EXISTS _tenant_id BIGINT NULL;
ALTER TABLE system_test_runs ADD COLUMN IF NOT EXISTS _tenant_id BIGINT NULL;

DO $$ BEGIN
  ALTER TABLE system_action_logs
    ADD CONSTRAINT fk_system_action_logs_tenant FOREIGN KEY (_tenant_id) REFERENCES tenants(_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE system_test_runs
    ADD CONSTRAINT fk_system_test_runs_tenant FOREIGN KEY (_tenant_id) REFERENCES tenants(_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_system_action_logs_tenant_occurred
  ON system_action_logs(_tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_system_test_runs_tenant_created
  ON system_test_runs(_tenant_id, _created_at DESC);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_system_test_runs_tenant_created;
DROP INDEX IF EXISTS ix_system_action_logs_tenant_occurred;
ALTER TABLE system_test_runs DROP CONSTRAINT IF EXISTS fk_system_test_runs_tenant;
ALTER TABLE system_action_logs DROP CONSTRAINT IF EXISTS fk_system_action_logs_tenant;
ALTER TABLE system_test_runs DROP COLUMN IF EXISTS _tenant_id;
ALTER TABLE system_action_logs DROP COLUMN IF EXISTS _tenant_id;
`);
}
