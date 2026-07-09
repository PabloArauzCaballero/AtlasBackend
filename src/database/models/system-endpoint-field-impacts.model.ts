import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_endpoint_field_impacts', timestamps: false })
export class SystemEndpointFieldImpactModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'endpoint_id', type: DataType.BIGINT, allowNull: false })
  declare endpointId: string;

  @Column({ field: 'data_entity_id', type: DataType.BIGINT, allowNull: false })
  declare dataEntityId: string;

  @Column({ field: 'field_name', type: DataType.STRING(180), allowNull: false })
  declare fieldName: string;

  @Column({ field: 'field_operation', type: DataType.STRING(40), allowNull: false })
  declare fieldOperation: string;

  @Column({ field: 'is_required_input', type: DataType.BOOLEAN, allowNull: false })
  declare isRequiredInput: boolean;

  @Column({ field: 'is_generated', type: DataType.BOOLEAN, allowNull: false })
  declare isGenerated: boolean;

  @Column({ field: 'is_sensitive', type: DataType.BOOLEAN, allowNull: false })
  declare isSensitive: boolean;

  @Column({ field: 'is_ml_candidate', type: DataType.BOOLEAN, allowNull: false })
  declare isMlCandidate: boolean;

  @Column({ field: 'ml_feature_group', type: DataType.STRING(120) })
  declare mlFeatureGroup: string | null;

  @Column({ field: 'validation_rule', type: DataType.JSONB, allowNull: false })
  declare validationRule: Record<string, unknown>;

  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
