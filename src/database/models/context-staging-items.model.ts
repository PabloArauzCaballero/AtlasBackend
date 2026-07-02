import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_staging_items', timestamps: false })
export class ContextStagingItemModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'catalog_id', type: DataType.BIGINT })
  declare catalogId: string | null;

  @Column({ field: 'ingestion_job_id', type: DataType.BIGINT })
  declare ingestionJobId: string | null;

  @Column({ field: 'proposed_item_code', type: DataType.STRING(140) })
  declare proposedItemCode: string | null;

  @Column({ field: 'proposed_item_name', type: DataType.STRING(220) })
  declare proposedItemName: string | null;

  @Column({ field: 'proposed_attributes_json', type: DataType.JSONB })
  declare proposedAttributesJson: Record<string, unknown> | null;

  @Column({ field: 'ai_suggested', type: DataType.BOOLEAN })
  declare aiSuggested: boolean | null;

  @Column({ field: 'review_status', type: DataType.STRING(40) })
  declare reviewStatus: string | null;

  @Column({ field: 'review_notes', type: DataType.TEXT })
  declare reviewNotes: string | null;

  @Column({ field: 'created_by_type', type: DataType.STRING(40) })
  declare createdByType: string | null;

  @Column({ field: 'created_by_platform_user_id', type: DataType.BIGINT })
  declare createdByPlatformUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
