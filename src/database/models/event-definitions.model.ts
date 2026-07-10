import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'event_definitions', timestamps: false })
export class EventDefinitionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'event_code', type: DataType.STRING(120) })
  declare eventCode: string | null;

  @Column({ field: 'event_name', type: DataType.STRING(180) })
  declare eventName: string | null;

  @Column({ field: 'event_family', type: DataType.STRING(80) })
  declare eventFamily: string | null;

  @Column({ field: 'source_package', type: DataType.STRING(120) })
  declare sourcePackage: string | null;

  @Column({ field: 'target_tables_json', type: DataType.JSONB })
  declare targetTablesJson: Record<string, unknown> | null;

  @Column({ field: 'expected_payload_schema_json', type: DataType.JSONB })
  declare expectedPayloadSchemaJson: Record<string, unknown> | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'build_phase', type: DataType.STRING(40) })
  declare buildPhase: string | null;

  @Column({ field: 'data_classification_code', type: DataType.STRING(80) })
  declare dataClassificationCode: string | null;

  @Column({ field: 'retention_policy_id', type: DataType.BIGINT })
  declare retentionPolicyId: string | null;

  @Column({ field: 'is_high_volume', type: DataType.BOOLEAN })
  declare isHighVolume: boolean | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: 'owner_team', type: DataType.STRING(80) })
  declare ownerTeam: string | null;

  @Column({ field: 'domain_code', type: DataType.STRING(120) })
  declare domainCode: string | null;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
