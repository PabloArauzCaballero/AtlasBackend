import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_assessment_contexts', timestamps: false })
export class RiskAssessmentContextModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'context_type', type: DataType.STRING(80) })
  declare contextType: string | null;

  @Column({ field: 'external_entity_type', type: DataType.STRING(80) })
  declare externalEntityType: string | null;

  @Column({ field: 'external_entity_id', type: DataType.STRING(120) })
  declare externalEntityId: string | null;

  @Column({ field: 'merchant_id_snapshot', type: DataType.BIGINT })
  declare merchantIdSnapshot: string | null;

  @Column({ field: 'merchant_code_snapshot', type: DataType.STRING(80) })
  declare merchantCodeSnapshot: string | null;

  @Column({ field: 'merchant_risk_band_snapshot', type: DataType.STRING(40) })
  declare merchantRiskBandSnapshot: string | null;

  @Column({ field: 'merchant_default_rate_snapshot', type: DataType.DECIMAL(8, 4) })
  declare merchantDefaultRateSnapshot: string | null;

  @Column({ field: 'store_id_snapshot', type: DataType.BIGINT })
  declare storeIdSnapshot: string | null;

  @Column({ field: 'product_category_snapshot', type: DataType.STRING(80) })
  declare productCategorySnapshot: string | null;

  @Column({ field: 'product_subcategory_snapshot', type: DataType.STRING(80) })
  declare productSubcategorySnapshot: string | null;

  @Column({ field: 'basket_item_count_snapshot', type: DataType.INTEGER })
  declare basketItemCountSnapshot: number | null;

  @Column({ field: 'basket_duplicate_item_count_snapshot', type: DataType.INTEGER })
  declare basketDuplicateItemCountSnapshot: number | null;

  @Column({ field: 'basket_anomaly_score', type: DataType.DECIMAL(5, 2) })
  declare basketAnomalyScore: string | null;

  @Column({ field: 'transaction_amount_snapshot', type: DataType.DECIMAL(14, 2) })
  declare transactionAmountSnapshot: string | null;

  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string | null;

  @Column({ field: 'purchase_to_declared_income_ratio', type: DataType.DECIMAL(10, 4) })
  declare purchaseToDeclaredIncomeRatio: string | null;

  @Column({ field: 'down_payment_required_pct_snapshot', type: DataType.DECIMAL(8, 4) })
  declare downPaymentRequiredPctSnapshot: string | null;

  @Column({ field: 'down_payment_behavior_snapshot', type: DataType.JSONB })
  declare downPaymentBehaviorSnapshot: Record<string, unknown> | null;

  @Column({ field: 'store_to_home_distance_meters', type: DataType.DECIMAL(12, 2) })
  declare storeToHomeDistanceMeters: string | null;

  @Column({ field: 'context_payload_hash', type: DataType.STRING(128) })
  declare contextPayloadHash: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
