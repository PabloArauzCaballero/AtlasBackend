/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_data_provider_requests_tenant_idempotency_audit" ON "data_provider_requests" ("_tenant_id", "idempotency_key", "requested_at") WHERE idempotency_key IS NOT NULL;`,
  );

  await queryInterface.sequelize.query(
    `DO $$
BEGIN
  -- to_regclass resuelve por el MISMO search_path que usa el CREATE de abajo. Antes se acotaba por
  -- n.nspname = current_schema(), que durante una migración es public —el primer elemento de
  -- ATLAS_MIGRATION_SEARCH_PATH— mientras el índice vive en integrations: la guarda respondía
  -- siempre «no existe» y la segunda pasada moría con «relation already exists».
  IF to_regclass('ux_data_provider_requests_tenant_idempotency_key') IS NULL THEN
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
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_data_provider_requests_tenant_idempotency_key"
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
