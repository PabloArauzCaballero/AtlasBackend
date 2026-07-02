import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_context_enrichments', timestamps: false })
export class CustomerContextEnrichmentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'observation_id', type: DataType.BIGINT })
  declare observationId: string | null;

  @Column({ field: 'catalog_id', type: DataType.BIGINT })
  declare catalogId: string | null;

  @Column({ field: 'catalog_version_id', type: DataType.BIGINT })
  declare catalogVersionId: string | null;

  @Column({ field: 'matched_context_item_id', type: DataType.BIGINT })
  declare matchedContextItemId: string | null;

  @Column({ field: 'catalog_code_snapshot', type: DataType.STRING(80) })
  declare catalogCodeSnapshot: string | null;

  @Column({ field: 'catalog_version_code_snapshot', type: DataType.STRING(60) })
  declare catalogVersionCodeSnapshot: string | null;

  @Column({ field: 'matched_item_code_snapshot', type: DataType.STRING(140) })
  declare matchedItemCodeSnapshot: string | null;

  @Column({ field: 'matched_item_name_snapshot', type: DataType.STRING(220) })
  declare matchedItemNameSnapshot: string | null;

  @Column({ field: 'enrichment_code', type: DataType.STRING(120) })
  declare enrichmentCode: string | null;

  @Column({ field: 'enrichment_value_json', type: DataType.JSONB })
  declare enrichmentValueJson: Record<string, unknown> | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'match_method', type: DataType.STRING(80) })
  declare matchMethod: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
