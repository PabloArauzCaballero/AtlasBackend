import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'watchlist_matches', timestamps: false })
export class WatchlistMatchModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'watchlist_entry_id', type: DataType.BIGINT })
  declare watchlistEntryId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'matched_entity_type', type: DataType.STRING(80) })
  declare matchedEntityType: string | null;

  @Column({ field: 'matched_value_hash', type: DataType.STRING(128) })
  declare matchedValueHash: string | null;

  @Column({ field: 'match_method', type: DataType.STRING(40) })
  declare matchMethod: string | null;

  @Column({ field: 'match_confidence', type: DataType.DECIMAL(5, 2) })
  declare matchConfidence: string | null;

  @Column({ field: 'opened_review_case_id', type: DataType.BIGINT })
  declare openedReviewCaseId: string | null;

  @Column({ field: 'opened_fraud_case_id', type: DataType.BIGINT })
  declare openedFraudCaseId: string | null;

  @Column({ field: 'matched_at', type: DataType.DATE })
  declare matchedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
