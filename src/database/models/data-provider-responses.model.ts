import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_provider_responses', timestamps: false })
export class DataProviderResponseModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'provider_request_id', type: DataType.BIGINT })
  declare providerRequestId: string | null;

  @Column({ field: 'payload_storage_strategy', type: DataType.STRING(40) })
  declare payloadStorageStrategy: string | null;

  @Column({ field: 'response_payload_json', type: DataType.JSONB })
  declare responsePayloadJson: Record<string, unknown> | null;

  @Column({ field: 'redacted_payload_json', type: DataType.JSONB })
  declare redactedPayloadJson: Record<string, unknown> | null;

  @Column({ field: 'raw_payload_s3_key', type: DataType.TEXT })
  declare rawPayloadS3Key: string | null;

  @Column({ field: 'response_hash', type: DataType.STRING(128) })
  declare responseHash: string | null;

  @Column({ field: 'normalized_payload_json', type: DataType.JSONB })
  declare normalizedPayloadJson: Record<string, unknown> | null;

  @Column({ field: 'contains_sensitive_data', type: DataType.BOOLEAN })
  declare containsSensitiveData: boolean | null;

  @Column({ field: 'retention_policy_id', type: DataType.BIGINT })
  declare retentionPolicyId: string | null;

  @Column({ field: 'retention_until', type: DataType.DATEONLY })
  declare retentionUntil: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
