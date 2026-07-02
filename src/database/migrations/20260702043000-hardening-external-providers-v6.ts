import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_data_provider_requests_tenant_idempotency_audit" ON "data_provider_requests" ("_tenant_id", "idempotency_key", "requested_at") WHERE idempotency_key IS NOT NULL;`,
  );

  await queryInterface.sequelize.query(
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ux_data_provider_requests_tenant_idempotency_key' AND n.nspname = current_schema()
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM (
        SELECT _tenant_id, idempotency_key, COUNT(*) AS total
        FROM data_provider_requests
        WHERE idempotency_key IS NOT NULL
        GROUP BY _tenant_id, idempotency_key
        HAVING COUNT(*) > 1
      ) duplicated_idempotency_keys
    ) THEN
      CREATE UNIQUE INDEX "ux_data_provider_requests_tenant_idempotency_key"
        ON "data_provider_requests" ("_tenant_id", "idempotency_key")
        WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;
END $$;`,
  );

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_data_provider_responses_tenant_request" ON "data_provider_responses" ("_tenant_id", "provider_request_id", "_created_at");`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ix_data_provider_responses_tenant_request";');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ux_data_provider_requests_tenant_idempotency_key";');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ix_data_provider_requests_tenant_idempotency_audit";');
}
