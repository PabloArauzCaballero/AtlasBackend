import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_consents', timestamps: false })
export class CustomerConsentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'consent_document_id', type: DataType.BIGINT })
  declare consentDocumentId: string | null;

  @Column({ field: 'purpose_code', type: DataType.STRING(80) })
  declare purposeCode: string | null;

  @Column({ field: 'granted', type: DataType.BOOLEAN })
  declare granted: boolean | null;

  @Column({ field: 'granted_at', type: DataType.DATE })
  declare grantedAt: Date | null;

  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;

  @Column({ field: 'channel', type: DataType.STRING(40) })
  declare channel: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'device_fingerprint_snapshot', type: DataType.STRING(128) })
  declare deviceFingerprintSnapshot: string | null;

  @Column({ field: 'user_agent', type: DataType.TEXT })
  declare userAgent: string | null;

  @Column({ field: 'evidence_snapshot_url', type: DataType.TEXT })
  declare evidenceSnapshotUrl: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
