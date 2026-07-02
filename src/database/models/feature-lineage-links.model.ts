import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'feature_lineage_links', timestamps: false })
export class FeatureLineageLinkModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'feature_value_id', type: DataType.BIGINT })
  declare featureValueId: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(80) })
  declare sourceType: string | null;

  @Column({ field: 'source_table', type: DataType.STRING(120) })
  declare sourceTable: string | null;

  @Column({ field: 'source_record_id', type: DataType.STRING(120) })
  declare sourceRecordId: string | null;

  @Column({ field: 'source_code', type: DataType.STRING(120) })
  declare sourceCode: string | null;

  @Column({ field: 'source_snapshot_json', type: DataType.JSONB })
  declare sourceSnapshotJson: Record<string, unknown> | null;

  @Column({ field: 'contribution_weight', type: DataType.DECIMAL(8, 4) })
  declare contributionWeight: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
