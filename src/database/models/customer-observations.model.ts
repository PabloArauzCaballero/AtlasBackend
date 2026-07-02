import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_observations', timestamps: false })
export class CustomerObservationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'observation_code', type: DataType.STRING(120) })
  declare observationCode: string | null;

  @Column({ field: 'value_text', type: DataType.TEXT })
  declare valueText: string | null;

  @Column({ field: 'value_number', type: DataType.DECIMAL(18, 4) })
  declare valueNumber: string | null;

  @Column({ field: 'value_boolean', type: DataType.BOOLEAN })
  declare valueBoolean: boolean | null;

  @Column({ field: 'value_json', type: DataType.JSONB })
  declare valueJson: Record<string, unknown> | null;

  @Column({ field: 'source_type', type: DataType.STRING(80) })
  declare sourceType: string | null;

  @Column({ field: 'source_provider_id', type: DataType.BIGINT })
  declare sourceProviderId: string | null;

  @Column({ field: 'evidence_id', type: DataType.BIGINT })
  declare evidenceId: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: 'derivation_method', type: DataType.STRING(120) })
  declare derivationMethod: string | null;

  @Column({ field: 'derivation_version', type: DataType.STRING(80) })
  declare derivationVersion: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
