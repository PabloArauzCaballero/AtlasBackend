import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_activity_summaries', timestamps: false })
export class CustomerActivitySummaryModel extends Model {
  @Column({ field: 'customer_id', type: DataType.BIGINT, primaryKey: true, allowNull: false })
  declare customerId: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'first_session_at', type: DataType.DATE })
  declare firstSessionAt: Date | null;

  @Column({ field: 'last_session_at', type: DataType.DATE })
  declare lastSessionAt: Date | null;

  @Column({ field: 'first_device_id', type: DataType.BIGINT })
  declare firstDeviceId: string | null;

  @Column({ field: 'usual_device_id', type: DataType.BIGINT })
  declare usualDeviceId: string | null;

  @Column({ field: 'total_sessions', type: DataType.INTEGER })
  declare totalSessions: number | null;

  @Column({ field: 'total_devices_seen', type: DataType.INTEGER })
  declare totalDevicesSeen: number | null;

  @Column({ field: 'failed_login_count_7d', type: DataType.INTEGER })
  declare failedLoginCount7d: number | null;

  @Column({ field: 'device_change_count_30d', type: DataType.INTEGER })
  declare deviceChangeCount30d: number | null;

  @Column({ field: 'suspicious_ip_count_30d', type: DataType.INTEGER })
  declare suspiciousIpCount30d: number | null;

  @Column({ field: 'current_risk_level', type: DataType.STRING(40) })
  declare currentRiskLevel: string | null;

  @Column({ field: 'current_trust_tier', type: DataType.STRING(40) })
  declare currentTrustTier: string | null;

  @Column({ field: 'last_risk_assessment_id', type: DataType.BIGINT })
  declare lastRiskAssessmentId: string | null;

  @Column({ field: 'last_risk_assessed_at', type: DataType.DATE })
  declare lastRiskAssessedAt: Date | null;

  @Column({ field: 'watchlist_hit_count_lifetime', type: DataType.INTEGER })
  declare watchlistHitCountLifetime: number | null;

  @Column({ field: 'fraud_case_count_lifetime', type: DataType.INTEGER })
  declare fraudCaseCountLifetime: number | null;

  @Column({ field: 'open_manual_review_count', type: DataType.INTEGER })
  declare openManualReviewCount: number | null;

  @Column({ field: 'recomputed_at', type: DataType.DATE })
  declare recomputedAt: Date | null;

  @Column({ field: 'computation_version', type: DataType.STRING(40) })
  declare computationVersion: string | null;
}
