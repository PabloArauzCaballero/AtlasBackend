import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'auth_events', timestamps: false })
export class AuthEventModel extends Model {
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

  @Column({ field: 'event_type', type: DataType.STRING(60) })
  declare eventType: string | null;

  @Column({ field: 'login_successful', type: DataType.BOOLEAN })
  declare loginSuccessful: boolean | null;

  @Column({ field: 'failure_reason_code', type: DataType.STRING(80) })
  declare failureReasonCode: string | null;

  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
