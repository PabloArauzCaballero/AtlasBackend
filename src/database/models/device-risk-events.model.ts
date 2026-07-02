import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'device_risk_events', timestamps: false })
export class DeviceRiskEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'event_type', type: DataType.STRING(80) })
  declare eventType: string | null;

  @Column({ field: 'previous_risk_status', type: DataType.STRING(40) })
  declare previousRiskStatus: string | null;

  @Column({ field: 'new_risk_status', type: DataType.STRING(40) })
  declare newRiskStatus: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: 'supporting_evidence_json', type: DataType.JSONB })
  declare supportingEvidenceJson: Record<string, unknown> | null;

  @Column({ field: 'happened_at', type: DataType.DATE })
  declare happenedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
