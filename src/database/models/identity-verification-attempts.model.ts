import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'identity_verification_attempts', timestamps: false })
export class IdentityVerificationAttemptModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'identity_document_id', type: DataType.BIGINT })
  declare identityDocumentId: string | null;

  @Column({ field: 'provider_request_id', type: DataType.BIGINT })
  declare providerRequestId: string | null;

  @Column({ field: 'consent_id', type: DataType.BIGINT })
  declare consentId: string | null;

  @Column({ field: 'verification_channel', type: DataType.STRING(40) })
  declare verificationChannel: string | null;

  @Column({ field: 'liveness_score', type: DataType.DECIMAL(5, 2) })
  declare livenessScore: string | null;

  @Column({ field: 'selfie_match_score', type: DataType.DECIMAL(5, 2) })
  declare selfieMatchScore: string | null;

  @Column({ field: 'document_forensics_score', type: DataType.DECIMAL(5, 2) })
  declare documentForensicsScore: string | null;

  @Column({ field: 'name_match_score', type: DataType.DECIMAL(5, 2) })
  declare nameMatchScore: string | null;

  @Column({ field: 'final_result', type: DataType.STRING(40) })
  declare finalResult: string | null;

  @Column({ field: 'reason_codes_json', type: DataType.JSONB })
  declare reasonCodesJson: Record<string, unknown> | null;

  @Column({ field: 'selfie_evidence_id', type: DataType.BIGINT })
  declare selfieEvidenceId: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE })
  declare requestedAt: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @Column({ field: 'manual_reviewed_by', type: DataType.BIGINT })
  declare manualReviewedBy: string | null;

  @Column({ field: 'manual_review_notes', type: DataType.TEXT })
  declare manualReviewNotes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
