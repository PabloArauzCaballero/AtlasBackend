import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'idempotency_keys', timestamps: false })
export class IdempotencyKeyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'tenant_scope', type: DataType.STRING(80), allowNull: false })
  declare tenantScope: string;

  @Column({ field: 'actor_type', type: DataType.STRING(40) })
  declare actorType: string | null;

  @Column({ field: 'actor_id', type: DataType.STRING(120) })
  declare actorId: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(160), allowNull: false })
  declare idempotencyKey: string;

  @Column({ field: 'scope', type: DataType.STRING(220), allowNull: false })
  declare scope: string;

  @Column({ field: 'request_hash', type: DataType.STRING(128), allowNull: false })
  declare requestHash: string;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'response_status', type: DataType.INTEGER })
  declare responseStatus: number | null;

  @Column({ field: 'response_body_json', type: DataType.JSONB })
  declare responseBodyJson: Record<string, unknown> | null;

  @Column({ field: 'locked_until', type: DataType.DATE })
  declare lockedUntil: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
