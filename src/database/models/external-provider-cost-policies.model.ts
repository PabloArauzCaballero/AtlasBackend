import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'external_provider_cost_policies', timestamps: false })
export class ExternalProviderCostPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'provider_id', type: DataType.BIGINT, allowNull: false })
  declare providerId: string;

  @Column({ field: 'query_type', type: DataType.STRING(80), allowNull: false })
  declare queryType: string;

  @Column({ field: 'unit_cost_amount', type: DataType.DECIMAL(18, 4), allowNull: false })
  declare unitCostAmount: string;

  @Column({ field: 'currency', type: DataType.STRING(3), allowNull: false })
  declare currency: string;

  @Column({ field: 'cost_tier', type: DataType.STRING(20), allowNull: false })
  declare costTier: string;

  @Column({ field: 'max_queries_per_user_per_day', type: DataType.INTEGER })
  declare maxQueriesPerUserPerDay: number | null;

  @Column({ field: 'max_queries_per_user_per_month', type: DataType.INTEGER })
  declare maxQueriesPerUserPerMonth: number | null;

  @Column({ field: 'max_queries_global_per_day', type: DataType.INTEGER })
  declare maxQueriesGlobalPerDay: number | null;

  @Column({ field: 'allowed_decision_stages_json', type: DataType.JSONB })
  declare allowedDecisionStagesJson: string[] | null;

  @Column({ field: 'requires_manual_approval', type: DataType.BOOLEAN, allowNull: false })
  declare requiresManualApproval: boolean;

  @Column({ field: 'requires_admin_role', type: DataType.BOOLEAN, allowNull: false })
  declare requiresAdminRole: boolean;

  @Column({ field: 'block_by_default', type: DataType.BOOLEAN, allowNull: false })
  declare blockByDefault: boolean;

  @Column({ field: 'cache_ttl_seconds', type: DataType.INTEGER })
  declare cacheTtlSeconds: number | null;

  @Column({ field: 'feature_ttl_seconds', type: DataType.INTEGER })
  declare featureTtlSeconds: number | null;

  @Column({ field: 'retry_max_attempts', type: DataType.INTEGER })
  declare retryMaxAttempts: number | null;

  @Column({ field: 'retry_backoff_seconds', type: DataType.INTEGER })
  declare retryBackoffSeconds: number | null;

  @Column({ field: 'active', type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean;

  @Column({ field: 'active_from', type: DataType.DATE })
  declare activeFrom: Date | null;

  @Column({ field: 'active_to', type: DataType.DATE })
  declare activeTo: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
