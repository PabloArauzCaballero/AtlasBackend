import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_approval_events', timestamps: false })
export class ContextApprovalEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'staging_item_id', type: DataType.BIGINT })
  declare stagingItemId: string | null;

  @Column({ field: 'catalog_version_id', type: DataType.BIGINT })
  declare catalogVersionId: string | null;

  @Column({ field: 'event_type', type: DataType.STRING(60) })
  declare eventType: string | null;

  @Column({ field: 'decided_by_platform_user_id', type: DataType.BIGINT })
  declare decidedByPlatformUserId: string | null;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: 'decision_reason', type: DataType.TEXT })
  declare decisionReason: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
