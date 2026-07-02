import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_action_logs', timestamps: false })
export class CustomerActionLogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'event_name', type: DataType.STRING(120) })
  declare eventName: string | null;

  @Column({ field: 'screen_name', type: DataType.STRING(120) })
  declare screenName: string | null;

  @Column({ field: 'action_payload_json', type: DataType.JSONB })
  declare actionPayloadJson: Record<string, unknown> | null;

  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
