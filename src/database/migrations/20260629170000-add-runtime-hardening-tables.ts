import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable('idempotency_keys', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    tenant_scope: { type: DataTypes.STRING(80), allowNull: false },
    actor_type: { type: DataTypes.STRING(40), allowNull: true },
    actor_id: { type: DataTypes.STRING(120), allowNull: true },
    idempotency_key: { type: DataTypes.STRING(160), allowNull: false },
    scope: { type: DataTypes.STRING(220), allowNull: false },
    request_hash: { type: DataTypes.STRING(128), allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false },
    response_status: { type: DataTypes.INTEGER, allowNull: true },
    response_body_json: { type: DataTypes.JSONB, allowNull: true },
    locked_until: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    _updated_at: { type: DataTypes.DATE, allowNull: true },
  });
  await queryInterface.addIndex('idempotency_keys', ['tenant_scope', 'scope', 'idempotency_key'], {
    name: 'ux_idempotency_scope_key',
    unique: true,
  });
  await queryInterface.addIndex('idempotency_keys', ['status', 'locked_until'], { name: 'ix_idempotency_status_locked_until' });

  await queryInterface.createTable('outbox_events', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
    aggregate_type: { type: DataTypes.STRING(120), allowNull: false },
    aggregate_id: { type: DataTypes.STRING(120), allowNull: true },
    event_code: { type: DataTypes.STRING(160), allowNull: false },
    event_payload_json: { type: DataTypes.JSONB, allowNull: true },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    available_at: { type: DataTypes.DATE, allowNull: true },
    processed_at: { type: DataTypes.DATE, allowNull: true },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    correlation_id: { type: DataTypes.STRING(120), allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    _updated_at: { type: DataTypes.DATE, allowNull: true },
  });
  await queryInterface.addIndex('outbox_events', ['status', 'available_at'], { name: 'ix_outbox_status_available_at' });
  await queryInterface.addIndex('outbox_events', ['_tenant_id', 'aggregate_type', 'aggregate_id'], { name: 'ix_outbox_aggregate' });

  await queryInterface.createTable('system_job_runs', {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
    job_code: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    input_json: { type: DataTypes.JSONB, allowNull: true },
    result_json: { type: DataTypes.JSONB, allowNull: true },
    error_message: { type: DataTypes.TEXT, allowNull: true },
    triggered_by_type: { type: DataTypes.STRING(40), allowNull: true },
    triggered_by_id: { type: DataTypes.STRING(120), allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await queryInterface.addIndex('system_job_runs', ['job_code', 'started_at'], { name: 'ix_system_job_runs_job_started' });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.dropTable('system_job_runs');
  await queryInterface.dropTable('outbox_events');
  await queryInterface.dropTable('idempotency_keys');
}
