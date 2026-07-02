import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'manual_review_events', timestamps: false })
export class ManualReviewEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'manual_review_case_id', type: DataType.BIGINT })
  declare manualReviewCaseId: string | null;

  @Column({ field: 'event_type', type: DataType.STRING(60) })
  declare eventType: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40) })
  declare actorType: string | null;

  @Column({ field: 'actor_internal_user_id', type: DataType.BIGINT })
  declare actorInternalUserId: string | null;

  @Column({ field: 'happened_at', type: DataType.DATE })
  declare happenedAt: Date | null;

  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: Record<string, unknown> | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
