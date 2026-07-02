import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'on_device_computation_runs', timestamps: false })
export class OnDeviceComputationRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'consent_id', type: DataType.BIGINT })
  declare consentId: string | null;

  @Column({ field: 'algorithm_code', type: DataType.STRING(100) })
  declare algorithmCode: string | null;

  @Column({ field: 'algorithm_version', type: DataType.STRING(80) })
  declare algorithmVersion: string | null;

  @Column({ field: 'computation_status', type: DataType.STRING(40) })
  declare computationStatus: string | null;

  @Column({ field: 'raw_contacts_stored', type: DataType.BOOLEAN })
  declare rawContactsStored: boolean | null;

  @Column({ field: 'raw_sms_stored', type: DataType.BOOLEAN })
  declare rawSmsStored: boolean | null;

  @Column({ field: 'integrity_hash', type: DataType.STRING(128) })
  declare integrityHash: string | null;

  @Column({ field: 'computed_at_device', type: DataType.DATE })
  declare computedAtDevice: Date | null;

  @Column({ field: 'received_at_server', type: DataType.DATE })
  declare receivedAtServer: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
