import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'evidence_extractions', timestamps: false })
export class EvidenceExtractionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'evidence_document_id', type: DataType.BIGINT })
  declare evidenceDocumentId: string | null;

  @Column({ field: 'extraction_method', type: DataType.STRING(80) })
  declare extractionMethod: string | null;

  @Column({ field: 'extraction_version', type: DataType.STRING(80) })
  declare extractionVersion: string | null;

  @Column({ field: 'extracted_data_json', type: DataType.JSONB })
  declare extractedDataJson: Record<string, unknown> | null;

  @Column({ field: 'redacted_extracted_data_json', type: DataType.JSONB })
  declare redactedExtractedDataJson: Record<string, unknown> | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'extracted_at', type: DataType.DATE })
  declare extractedAt: Date | null;

  @Column({ field: 'processing_duration_ms', type: DataType.INTEGER })
  declare processingDurationMs: number | null;

  @Column({ field: 'requires_review', type: DataType.BOOLEAN })
  declare requiresReview: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
