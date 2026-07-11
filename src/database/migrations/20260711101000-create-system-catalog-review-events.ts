import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS system_catalog_review_events (
  _id BIGSERIAL PRIMARY KEY,
  _tenant_id BIGINT NULL REFERENCES tenants(_id),
  target_type VARCHAR(80) NOT NULL,
  target_id BIGINT NOT NULL,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  previous_confidence VARCHAR(40),
  new_confidence VARCHAR(40),
  notes TEXT,
  actor_id VARCHAR(120),
  actor_role VARCHAR(80) NOT NULL,
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_system_catalog_review_events_target
  ON system_catalog_review_events(target_type, target_id, _created_at DESC);
CREATE INDEX IF NOT EXISTS ix_system_catalog_review_events_tenant
  ON system_catalog_review_events(_tenant_id, _created_at DESC);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS system_catalog_review_events;`);
}
