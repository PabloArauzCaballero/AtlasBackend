import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'evidence_documents', timestamps: false })
export class EvidenceDocumentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'document_type', type: DataType.STRING(80) })
  declare documentType: string | null;

  @Column({ field: 's3_bucket', type: DataType.STRING(120) })
  declare s3Bucket: string | null;

  @Column({ field: 's3_key', type: DataType.TEXT })
  declare s3Key: string | null;

  @Column({ field: 'file_hash_sha256', type: DataType.STRING(128) })
  declare fileHashSha256: string | null;

  @Column({ field: 'mime_type', type: DataType.STRING(100) })
  declare mimeType: string | null;

  @Column({ field: 'file_size_bytes', type: DataType.BIGINT })
  declare fileSizeBytes: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'uploaded_at', type: DataType.DATE })
  declare uploadedAt: Date | null;

  @Column({ field: 'uploaded_from_ip', type: DataType.INET })
  declare uploadedFromIp: string | null;

  @Column({ field: 'uploaded_from_session_id', type: DataType.BIGINT })
  declare uploadedFromSessionId: string | null;

  @Column({ field: 'uploaded_from_device_fingerprint', type: DataType.STRING(180) })
  declare uploadedFromDeviceFingerprint: string | null;

  @Column({ field: 'retention_policy_id', type: DataType.BIGINT })
  declare retentionPolicyId: string | null;

  @Column({ field: 'expires_at', type: DataType.DATEONLY })
  declare expiresAt: string | null;

  @Column({ field: 'retention_until', type: DataType.DATEONLY })
  declare retentionUntil: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
