import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_sessions', timestamps: false })
export class CustomerSessionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'session_token_hash', type: DataType.STRING(128) })
  declare sessionTokenHash: string | null;

  @Column({ field: 'channel', type: DataType.STRING(40) })
  declare channel: string | null;

  @Column({ field: 'auth_method', type: DataType.STRING(60) })
  declare authMethod: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'ended_at', type: DataType.DATE })
  declare endedAt: Date | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'user_agent', type: DataType.TEXT })
  declare userAgent: string | null;

  @Column({ field: 'gps_lat', type: DataType.DECIMAL(10, 7) })
  declare gpsLat: string | null;

  @Column({ field: 'gps_lng', type: DataType.DECIMAL(10, 7) })
  declare gpsLng: string | null;

  @Column({ field: 'gps_accuracy_meters', type: DataType.DECIMAL(8, 2) })
  declare gpsAccuracyMeters: string | null;

  @Column({ field: 'session_status', type: DataType.STRING(40) })
  declare sessionStatus: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
