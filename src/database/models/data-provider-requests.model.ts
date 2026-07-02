import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_provider_requests', timestamps: false })
export class DataProviderRequestModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'provider_id', type: DataType.BIGINT })
  declare providerId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'consent_id', type: DataType.BIGINT })
  declare consentId: string | null;

  @Column({ field: 'request_type', type: DataType.STRING(80) })
  declare requestType: string | null;

  @Column({ field: 'provider_request_ref', type: DataType.STRING(160) })
  declare providerRequestRef: string | null;

  @Column({ field: 'purpose_code', type: DataType.STRING(100) })
  declare purposeCode: string | null;

  @Column({ field: 'decision_stage', type: DataType.STRING(60) })
  declare decisionStage: string | null;

  @Column({ field: 'mode_used', type: DataType.STRING(30) })
  declare modeUsed: string | null;

  @Column({ field: 'estimated_cost_amount', type: DataType.DECIMAL(18, 4) })
  declare estimatedCostAmount: string | null;

  @Column({ field: 'actual_cost_amount', type: DataType.DECIMAL(18, 4) })
  declare actualCostAmount: string | null;

  @Column({ field: 'currency', type: DataType.STRING(3) })
  declare currency: string | null;

  @Column({ field: 'requested_by_user_id', type: DataType.BIGINT })
  declare requestedByUserId: string | null;

  @Column({ field: 'approved_by_admin_id', type: DataType.BIGINT })
  declare approvedByAdminId: string | null;

  @Column({ field: 'approval_status', type: DataType.STRING(40) })
  declare approvalStatus: string | null;

  @Column({ field: 'error_message_safe', type: DataType.TEXT })
  declare errorMessageSafe: string | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;

  @Column({ field: 'cached_from_request_id', type: DataType.BIGINT })
  declare cachedFromRequestId: string | null;

  @Column({ field: 'retry_of_request_id', type: DataType.BIGINT })
  declare retryOfRequestId: string | null;

  @Column({ field: 'request_payload_hash', type: DataType.STRING(128) })
  declare requestPayloadHash: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(128) })
  declare idempotencyKey: string | null;

  @Column({ field: 'response_status', type: DataType.STRING(40) })
  declare responseStatus: string | null;

  @Column({ field: 'response_code', type: DataType.STRING(80) })
  declare responseCode: string | null;

  @Column({ field: 'latency_ms', type: DataType.INTEGER })
  declare latencyMs: number | null;

  @Column({ field: 'requested_at', type: DataType.DATE })
  declare requestedAt: Date | null;

  @Column({ field: 'responded_at', type: DataType.DATE })
  declare respondedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
