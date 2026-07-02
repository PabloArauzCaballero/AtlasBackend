import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'consent_events', timestamps: false })
export class ConsentEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_consent_id', type: DataType.BIGINT })
  declare customerConsentId: string | null;

  @Column({ field: 'event_type', type: DataType.STRING(40) })
  declare eventType: string | null;

  @Column({ field: 'happened_at', type: DataType.DATE })
  declare happenedAt: Date | null;

  @Column({ field: 'channel', type: DataType.STRING(40) })
  declare channel: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'device_fingerprint_snapshot', type: DataType.STRING(180) })
  declare deviceFingerprintSnapshot: string | null;

  @Column({ field: 'triggered_by_type', type: DataType.STRING(40) })
  declare triggeredByType: string | null;

  @Column({ field: 'triggered_by_internal_user_id', type: DataType.BIGINT })
  declare triggeredByInternalUserId: string | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
