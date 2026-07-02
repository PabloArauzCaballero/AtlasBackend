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

async function tableExists(queryInterface: QueryInterface, tableName: string): Promise<boolean> {
  const [rows] = (await queryInterface.sequelize.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :tableName) AS exists;`,
    { replacements: { tableName } },
  )) as [{ exists: boolean }[], unknown];
  return rows[0]?.exists === true;
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await addColumnIfMissing(queryInterface, 'data_providers', 'provider_category', { type: DataTypes.STRING(60), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_providers', 'provider_status', {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'ACTIVE',
  });
  await addColumnIfMissing(queryInterface, 'data_providers', 'default_mode', {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'mock_local',
  });
  await addColumnIfMissing(queryInterface, 'data_providers', 'requires_consent', {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  });
  await addColumnIfMissing(queryInterface, 'data_providers', 'requires_manual_approval', {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
  });
  await addColumnIfMissing(queryInterface, 'data_providers', 'is_costly', {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
  });
  await addColumnIfMissing(queryInterface, 'data_providers', 'description', { type: DataTypes.TEXT, allowNull: true });

  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'purpose_code', { type: DataTypes.STRING(100), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'decision_stage', { type: DataTypes.STRING(60), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'mode_used', { type: DataTypes.STRING(30), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'estimated_cost_amount', {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'actual_cost_amount', {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'currency', { type: DataTypes.STRING(3), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'requested_by_user_id', { type: DataTypes.BIGINT, allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'approved_by_admin_id', { type: DataTypes.BIGINT, allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'approval_status', { type: DataTypes.STRING(40), allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'error_message_safe', { type: DataTypes.TEXT, allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_requests', 'metadata_json', { type: DataTypes.JSONB, allowNull: true });

  await addColumnIfMissing(queryInterface, 'data_provider_responses', 'provider_status_code', { type: DataTypes.INTEGER, allowNull: true });
  await addColumnIfMissing(queryInterface, 'data_provider_responses', 'provider_reference', {
    type: DataTypes.STRING(160),
    allowNull: true,
  });

  if (!(await tableExists(queryInterface, 'external_provider_cost_policies'))) {
    await queryInterface.createTable('external_provider_cost_policies', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      provider_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'data_providers', key: '_id' } },
      query_type: { type: DataTypes.STRING(80), allowNull: false },
      unit_cost_amount: { type: DataTypes.DECIMAL(18, 4), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'BOB' },
      cost_tier: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'LOW' },
      max_queries_per_user_per_day: { type: DataTypes.INTEGER, allowNull: true },
      max_queries_per_user_per_month: { type: DataTypes.INTEGER, allowNull: true },
      max_queries_global_per_day: { type: DataTypes.INTEGER, allowNull: true },
      allowed_decision_stages_json: { type: DataTypes.JSONB, allowNull: true },
      requires_manual_approval: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      requires_admin_role: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      block_by_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      active_from: { type: DataTypes.DATE, allowNull: true },
      active_to: { type: DataTypes.DATE, allowNull: true },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex('external_provider_cost_policies', ['provider_id', 'query_type'], {
      name: 'ux_external_provider_cost_policy_provider_query',
      unique: true,
    });
  }

  if (!(await tableExists(queryInterface, 'provider_health_logs'))) {
    await queryInterface.createTable('provider_health_logs', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      provider_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'data_providers', key: '_id' } },
      status: { type: DataTypes.STRING(20), allowNull: false },
      mode_checked: { type: DataTypes.STRING(30), allowNull: false },
      latency_ms: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      checked_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      error_code: { type: DataTypes.STRING(80), allowNull: true },
      error_message_safe: { type: DataTypes.TEXT, allowNull: true },
      metadata_json: { type: DataTypes.JSONB, allowNull: true },
    });
  }

  if (!(await tableExists(queryInterface, 'external_oauth_connections'))) {
    await queryInterface.createTable('external_oauth_connections', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: false },
      customer_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'customers', key: '_id' } },
      provider_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'data_providers', key: '_id' } },
      provider_code: { type: DataTypes.STRING(80), allowNull: false },
      external_subject_hash: { type: DataTypes.STRING(128), allowNull: true },
      scopes_granted_json: { type: DataTypes.JSONB, allowNull: true },
      token_reference: { type: DataTypes.TEXT, allowNull: true },
      token_expires_at: { type: DataTypes.DATE, allowNull: true },
      connection_status: { type: DataTypes.STRING(30), allowNull: false },
      connected_at: { type: DataTypes.DATE, allowNull: true },
      disconnected_at: { type: DataTypes.DATE, allowNull: true },
      last_sync_at: { type: DataTypes.DATE, allowNull: true },
      metadata_json: { type: DataTypes.JSONB, allowNull: true },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_data_providers_provider_code" ON "data_providers" ("provider_code") WHERE provider_code IS NOT NULL;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.dropTable('external_oauth_connections');
  await queryInterface.dropTable('provider_health_logs');
  await queryInterface.dropTable('external_provider_cost_policies');

  await queryInterface.sequelize.query('DROP INDEX IF EXISTS "ux_data_providers_provider_code";');

  const dataProviderResponseColumns = ['provider_reference', 'provider_status_code'];
  for (const column of dataProviderResponseColumns) {
    const table = await queryInterface.describeTable('data_provider_responses');
    if (table[column]) await queryInterface.removeColumn('data_provider_responses', column);
  }

  const dataProviderRequestColumns = [
    'metadata_json',
    'error_message_safe',
    'approval_status',
    'approved_by_admin_id',
    'requested_by_user_id',
    'currency',
    'actual_cost_amount',
    'estimated_cost_amount',
    'mode_used',
    'decision_stage',
    'purpose_code',
  ];
  for (const column of dataProviderRequestColumns) {
    const table = await queryInterface.describeTable('data_provider_requests');
    if (table[column]) await queryInterface.removeColumn('data_provider_requests', column);
  }

  const dataProviderColumns = [
    'description',
    'is_costly',
    'requires_manual_approval',
    'requires_consent',
    'default_mode',
    'provider_status',
    'provider_category',
  ];
  for (const column of dataProviderColumns) {
    const table = await queryInterface.describeTable('data_providers');
    if (table[column]) await queryInterface.removeColumn('data_providers', column);
  }
}
