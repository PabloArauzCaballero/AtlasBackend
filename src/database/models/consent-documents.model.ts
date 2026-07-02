import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'consent_documents', timestamps: false })
export class ConsentDocumentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'document_code', type: DataType.STRING(80) })
  declare documentCode: string | null;

  @Column({ field: 'version_code', type: DataType.STRING(40) })
  declare versionCode: string | null;

  @Column({ field: 'language', type: DataType.STRING(10) })
  declare language: string | null;

  @Column({ field: 'effective_from', type: DataType.DATEONLY })
  declare effectiveFrom: string | null;

  @Column({ field: 'effective_until', type: DataType.DATEONLY })
  declare effectiveUntil: string | null;

  @Column({ field: 'content_url', type: DataType.TEXT })
  declare contentUrl: string | null;

  @Column({ field: 'content_hash', type: DataType.STRING(128) })
  declare contentHash: string | null;

  @Column({ field: 'requires_explicit_action', type: DataType.BOOLEAN })
  declare requiresExplicitAction: boolean | null;

  @Column({ field: 'published_by_internal_user_id', type: DataType.BIGINT })
  declare publishedByInternalUserId: string | null;

  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
