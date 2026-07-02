import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'global_device_fingerprints', timestamps: false })
export class GlobalDeviceFingerprintModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'device_fingerprint', type: DataType.STRING(180) })
  declare deviceFingerprint: string | null;

  @Column({ field: 'fingerprint_version', type: DataType.STRING(60) })
  declare fingerprintVersion: string | null;

  @Column({ field: 'global_first_seen_at', type: DataType.DATE })
  declare globalFirstSeenAt: Date | null;

  @Column({ field: 'global_last_seen_at', type: DataType.DATE })
  declare globalLastSeenAt: Date | null;

  @Column({ field: 'global_reuse_count', type: DataType.INTEGER })
  declare globalReuseCount: number | null;

  @Column({ field: 'global_risk_status', type: DataType.STRING(40) })
  declare globalRiskStatus: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
