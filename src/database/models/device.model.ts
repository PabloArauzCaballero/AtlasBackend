import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'devices', timestamps: false })
export class DeviceModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'global_device_fingerprint_id', type: DataType.BIGINT })
  declare globalDeviceFingerprintId: string | null;

  @Column({ field: 'device_fingerprint', type: DataType.STRING(128) })
  declare deviceFingerprint: string | null;

  @Column({ field: 'fingerprint_version', type: DataType.STRING(40) })
  declare fingerprintVersion: string | null;

  @Column({ field: 'first_seen_at', type: DataType.DATE })
  declare firstSeenAt: Date | null;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  @Column({ field: 'tenant_reuse_count', type: DataType.INTEGER })
  declare tenantReuseCount: number | null;

  @Column({ field: 'risk_status', type: DataType.STRING(40) })
  declare riskStatus: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
