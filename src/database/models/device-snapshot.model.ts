import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'device_snapshots', timestamps: false })
export class DeviceSnapshotModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'brand', type: DataType.STRING(80) })
  declare brand: string | null;

  @Column({ field: 'model', type: DataType.STRING(120) })
  declare model: string | null;

  @Column({ field: 'os_family', type: DataType.STRING(40) })
  declare osFamily: string | null;

  @Column({ field: 'os_version', type: DataType.STRING(60) })
  declare osVersion: string | null;

  @Column({ field: 'app_version', type: DataType.STRING(60) })
  declare appVersion: string | null;

  @Column({ field: 'is_rooted', type: DataType.BOOLEAN })
  declare isRooted: boolean | null;

  @Column({ field: 'is_emulator', type: DataType.BOOLEAN })
  declare isEmulator: boolean | null;

  @Column({ field: 'vpn_detected', type: DataType.BOOLEAN })
  declare vpnDetected: boolean | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
