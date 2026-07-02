import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_identity_documents', timestamps: false })
export class CustomerIdentityDocumentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'document_type', type: DataType.STRING(30) })
  declare documentType: string | null;

  @Column({ field: 'declared_number_hash', type: DataType.STRING(128) })
  declare declaredNumberHash: string | null;

  @Column({ field: 'declared_number_encrypted', type: DataType.BLOB })
  declare declaredNumberEncrypted: string | null;

  @Column({ field: 'declared_number_last_4', type: DataType.STRING(4) })
  declare declaredNumberLast4: string | null;

  @Column({ field: 'declared_complement', type: DataType.STRING(10) })
  declare declaredComplement: string | null;

  @Column({ field: 'declared_issued_in', type: DataType.STRING(60) })
  declare declaredIssuedIn: string | null;

  @Column({ field: 'ocr_number_hash', type: DataType.STRING(128) })
  declare ocrNumberHash: string | null;

  @Column({ field: 'ocr_full_name', type: DataType.STRING(260) })
  declare ocrFullName: string | null;

  @Column({ field: 'ocr_birth_date', type: DataType.DATEONLY })
  declare ocrBirthDate: string | null;

  @Column({ field: 'ocr_confidence_score', type: DataType.DECIMAL(5, 2) })
  declare ocrConfidenceScore: string | null;

  @Column({ field: 'verified_number_hash', type: DataType.STRING(128) })
  declare verifiedNumberHash: string | null;

  @Column({ field: 'issued_at', type: DataType.DATEONLY })
  declare issuedAt: string | null;

  @Column({ field: 'expires_at', type: DataType.DATEONLY })
  declare expiresAt: string | null;

  @Column({ field: 'front_evidence_id', type: DataType.BIGINT })
  declare frontEvidenceId: string | null;

  @Column({ field: 'back_evidence_id', type: DataType.BIGINT })
  declare backEvidenceId: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
