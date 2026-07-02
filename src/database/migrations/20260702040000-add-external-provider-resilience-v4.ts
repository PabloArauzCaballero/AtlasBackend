import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

async function addColumnIfMissing(
  queryInterface: QueryInterface,
  tableName: string,
  columnName: string,
  definition: Parameters<QueryInterface['addColumn']>[2],
): Promise<void> {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function removeColumnIfExists(queryInterface: QueryInterface, tableName: string, columnName: string): Promise<void> {
  const table = await queryInterface.describeTable(tableName);
  if (table[columnName]) await queryInterface.removeColumn(tableName, columnName);
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await addColumnIfMissing(queryInterface, 'external_provider_cost_policies', 'cache_ttl_seconds', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'external_provider_cost_policies', 'feature_ttl_seconds', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'external_provider_cost_policies', 'retry_max_attempts', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'external_provider_cost_policies', 'retry_backoff_seconds', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'cached_from_request_id', {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'data_provider_requests', key: '_id' },
  });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'retry_of_request_id', {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'data_provider_requests', key: '_id' },
  });
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_data_provider_requests_cache_lookup" ON "data_provider_requests" ("_tenant_id", "provider_id", "customer_id", "request_type", "request_payload_hash", "response_status", "requested_at");`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_data_provider_requests_cost_usage" ON "data_provider_requests" ("provider_id", "requested_at", "response_status");`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ix_data_provider_requests_cost_usage";');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ix_data_provider_requests_cache_lookup";');
  await removeColumnIfExists(queryInterface, 'data_provider_requests', 'retry_of_request_id');
  await removeColumnIfExists(queryInterface, 'data_provider_requests', 'cached_from_request_id');
  await removeColumnIfExists(queryInterface, 'external_provider_cost_policies', 'retry_backoff_seconds');
  await removeColumnIfExists(queryInterface, 'external_provider_cost_policies', 'retry_max_attempts');
  await removeColumnIfExists(queryInterface, 'external_provider_cost_policies', 'feature_ttl_seconds');
  await removeColumnIfExists(queryInterface, 'external_provider_cost_policies', 'cache_ttl_seconds');
}
