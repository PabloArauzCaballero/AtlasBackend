import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'outbox_events', timestamps: false })
export class OutboxEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'aggregate_type', type: DataType.STRING(120), allowNull: false })
  declare aggregateType: string;

  @Column({ field: 'aggregate_id', type: DataType.STRING(120) })
  declare aggregateId: string | null;

  @Column({ field: 'event_code', type: DataType.STRING(160), allowNull: false })
  declare eventCode: string;

  @Column({ field: 'event_payload_json', type: DataType.JSONB })
  declare eventPayloadJson: Record<string, unknown> | null;

  @Column({ field: 'event_family', type: DataType.STRING(80) })
  declare eventFamily: string | null;

  @Column({ field: 'event_version', type: DataType.INTEGER })
  declare eventVersion: number | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'priority', type: DataType.INTEGER })
  declare priority: number | null;

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false })
  declare attempts: number;

  @Column({ field: 'max_attempts', type: DataType.INTEGER })
  declare maxAttempts: number | null;

  @Column({ field: 'locked_at', type: DataType.DATE })
  declare lockedAt: Date | null;

  @Column({ field: 'locked_by', type: DataType.STRING(120) })
  declare lockedBy: string | null;

  @Column({ field: 'available_at', type: DataType.DATE })
  declare availableAt: Date | null;

  @Column({ field: 'processed_at', type: DataType.DATE })
  declare processedAt: Date | null;

  @Column({ field: 'failed_at', type: DataType.DATE })
  declare failedAt: Date | null;

  @Column({ field: 'error_code', type: DataType.STRING(120) })
  declare errorCode: string | null;

  @Column({ field: 'last_error', type: DataType.TEXT })
  declare lastError: string | null;

  @Column({ field: 'correlation_id', type: DataType.STRING(120) })
  declare correlationId: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(180) })
  declare idempotencyKey: string | null;

  @Column({ field: 'causation_id', type: DataType.STRING(120) })
  declare causationId: string | null;

  @Column({ field: 'source_module', type: DataType.STRING(120) })
  declare sourceModule: string | null;

  @Column({ field: 'source_action', type: DataType.STRING(120) })
  declare sourceAction: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
