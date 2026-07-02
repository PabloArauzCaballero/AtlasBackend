import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'evidence_reviews', timestamps: false })
export class EvidenceReviewModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'evidence_document_id', type: DataType.BIGINT })
  declare evidenceDocumentId: string | null;

  @Column({ field: 'reviewed_by', type: DataType.BIGINT })
  declare reviewedBy: string | null;

  @Column({ field: 'review_status', type: DataType.STRING(40) })
  declare reviewStatus: string | null;

  @Column({ field: 'reviewed_corrections_json', type: DataType.JSONB })
  declare reviewedCorrectionsJson: Record<string, unknown> | null;

  @Column({ field: 'rejection_reason_code', type: DataType.STRING(80) })
  declare rejectionReasonCode: string | null;

  @Column({ field: 'reviewed_at', type: DataType.DATE })
  declare reviewedAt: Date | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
