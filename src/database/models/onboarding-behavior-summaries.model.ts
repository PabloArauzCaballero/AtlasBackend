import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'onboarding_behavior_summaries', timestamps: false })
export class OnboardingBehaviorSummaryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'completion_time_seconds', type: DataType.INTEGER })
  declare completionTimeSeconds: number | null;

  @Column({ field: 'inter_screen_timing_json', type: DataType.JSONB })
  declare interScreenTimingJson: Record<string, unknown> | null;

  @Column({ field: 'form_error_rate', type: DataType.DECIMAL(8, 4) })
  declare formErrorRate: string | null;

  @Column({ field: 'ci_copy_paste_detected', type: DataType.BOOLEAN })
  declare ciCopyPasteDetected: boolean | null;

  @Column({ field: 'abandonment_count_prior', type: DataType.INTEGER })
  declare abandonmentCountPrior: number | null;

  @Column({ field: 'permission_grant_score', type: DataType.DECIMAL(5, 2) })
  declare permissionGrantScore: string | null;

  @Column({ field: 'behavior_cluster_code', type: DataType.STRING(80) })
  declare behaviorClusterCode: string | null;

  @Column({ field: 'bot_likelihood_score', type: DataType.DECIMAL(5, 2) })
  declare botLikelihoodScore: string | null;

  @Column({ field: 'computation_version', type: DataType.STRING(40) })
  declare computationVersion: string | null;

  @Column({ field: 'computed_at', type: DataType.DATE })
  declare computedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
