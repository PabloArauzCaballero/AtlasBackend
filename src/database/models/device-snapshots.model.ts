import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'device_snapshots', timestamps: false })
export class DeviceSnapshotModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'brand', type: DataType.STRING(100) })
  declare brand: string | null;

  @Column({ field: 'model', type: DataType.STRING(160) })
  declare model: string | null;

  @Column({ field: 'os_family', type: DataType.STRING(40) })
  declare osFamily: string | null;

  @Column({ field: 'os_version', type: DataType.STRING(80) })
  declare osVersion: string | null;

  @Column({ field: 'app_version', type: DataType.STRING(80) })
  declare appVersion: string | null;

  @Column({ field: 'device_release_year', type: DataType.INTEGER })
  declare deviceReleaseYear: number | null;

  @Column({ field: 'device_age_months', type: DataType.INTEGER })
  declare deviceAgeMonths: number | null;

  @Column({ field: 'device_tier_snapshot', type: DataType.STRING(40) })
  declare deviceTierSnapshot: string | null;

  @Column({ field: 'estimated_device_value_bs_snapshot', type: DataType.DECIMAL(14, 2) })
  declare estimatedDeviceValueBsSnapshot: string | null;

  @Column({ field: 'is_rooted', type: DataType.BOOLEAN })
  declare isRooted: boolean | null;

  @Column({ field: 'is_emulator', type: DataType.BOOLEAN })
  declare isEmulator: boolean | null;

  @Column({ field: 'vpn_detected', type: DataType.BOOLEAN })
  declare vpnDetected: boolean | null;

  @Column({ field: 'screen_count', type: DataType.INTEGER })
  declare screenCount: number | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
