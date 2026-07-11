import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_action_logs', timestamps: false })
export class SystemActionLogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'request_id', type: DataType.STRING(120) })
  declare requestId: string | null;

  @Column({ field: 'correlation_id', type: DataType.STRING(120) })
  declare correlationId: string | null;

  @Column({ field: 'endpoint_catalog_id', type: DataType.BIGINT })
  declare endpointCatalogId: string | null;

  @Column({ field: 'actor_user_id', type: DataType.STRING(80) })
  declare actorUserId: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(60) })
  declare actorType: string | null;

  @Column({ field: 'actor_role', type: DataType.STRING(80) })
  declare actorRole: string | null;

  @Column({ field: 'actor_internal_user_id', type: DataType.BIGINT })
  declare actorInternalUserId: string | null;

  @Column({ field: 'actor_platform_user_id', type: DataType.BIGINT })
  declare actorPlatformUserId: string | null;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare method: string;

  @Column({ field: 'route_template', type: DataType.TEXT })
  declare routeTemplate: string | null;

  @Column({ field: 'resolved_url_sanitized', type: DataType.TEXT, allowNull: false })
  declare resolvedUrlSanitized: string;

  @Column({ type: DataType.STRING(120) })
  declare module: string | null;

  @Column({ field: 'action_name', type: DataType.STRING(180) })
  declare actionName: string | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'user_agent', type: DataType.TEXT })
  declare userAgent: string | null;

  @Column({ field: 'target_type', type: DataType.STRING(120) })
  declare targetType: string | null;

  @Column({ field: 'target_id', type: DataType.STRING(120) })
  declare targetId: string | null;

  @Column({ field: 'merchant_id', type: DataType.BIGINT })
  declare merchantId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'request_payload_sanitized', type: DataType.JSONB, allowNull: false })
  declare requestPayloadSanitized: Record<string, unknown>;

  @Column({ field: 'request_payload_hash', type: DataType.STRING(128) })
  declare requestPayloadHash: string | null;

  @Column({ field: 'response_status_code', type: DataType.INTEGER })
  declare responseStatusCode: number | null;

  @Column({ field: 'response_summary_sanitized', type: DataType.JSONB, allowNull: false })
  declare responseSummarySanitized: Record<string, unknown>;

  @Column({ field: 'error_code', type: DataType.STRING(120) })
  declare errorCode: string | null;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @Column({ field: 'idempotency_key_hash', type: DataType.STRING(128) })
  declare idempotencyKeyHash: string | null;

  @Column({ field: 'idempotency_key_last4', type: DataType.STRING(8) })
  declare idempotencyKeyLast4: string | null;

  @Column({ field: 'risk_level', type: DataType.STRING(20), allowNull: false })
  declare riskLevel: string;

  @Column({ field: 'contains_pii', type: DataType.BOOLEAN, allowNull: false })
  declare containsPii: boolean;

  @Column({ field: 'occurred_at', type: DataType.DATE, allowNull: false })
  declare occurredAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
