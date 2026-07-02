import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_device_links', timestamps: false })
export class CustomerDeviceLinkModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'link_status', type: DataType.STRING(40) })
  declare linkStatus: string | null;

  @Column({ field: 'is_primary_device', type: DataType.BOOLEAN })
  declare isPrimaryDevice: boolean | null;

  @Column({ field: 'trust_level', type: DataType.STRING(40) })
  declare trustLevel: string | null;

  @Column({ field: 'first_seen_session_id', type: DataType.BIGINT })
  declare firstSeenSessionId: string | null;

  @Column({ field: 'last_seen_session_id', type: DataType.BIGINT })
  declare lastSeenSessionId: string | null;

  @Column({ field: 'first_seen_at', type: DataType.DATE })
  declare firstSeenAt: Date | null;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
