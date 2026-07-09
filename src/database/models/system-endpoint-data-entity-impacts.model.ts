import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_endpoint_data_entity_impacts', timestamps: false })
export class SystemEndpointDataEntityImpactModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'endpoint_id', type: DataType.BIGINT, allowNull: false })
  declare endpointId: string;

  @Column({ field: 'data_entity_id', type: DataType.BIGINT, allowNull: false })
  declare dataEntityId: string;

  @Column({ field: 'operation_type', type: DataType.STRING(40), allowNull: false })
  declare operationType: string;

  @Column({ field: 'impact_level', type: DataType.STRING(20), allowNull: false })
  declare impactLevel: string;

  @Column({ field: 'is_primary_entity', type: DataType.BOOLEAN, allowNull: false })
  declare isPrimaryEntity: boolean;

  @Column({ field: 'is_transactional', type: DataType.BOOLEAN, allowNull: false })
  declare isTransactional: boolean;

  @Column({ field: 'rollback_required', type: DataType.BOOLEAN, allowNull: false })
  declare rollbackRequired: boolean;

  @Column({ field: 'affects_customer_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsCustomerState: boolean;

  @Column({ field: 'affects_financial_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsFinancialState: boolean;

  @Column({ field: 'affects_risk_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsRiskState: boolean;

  @Column({ field: 'affects_legal_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsLegalState: boolean;

  @Column({ field: 'affects_device_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsDeviceState: boolean;

  @Column({ field: 'affects_notification_state', type: DataType.BOOLEAN, allowNull: false })
  declare affectsNotificationState: boolean;

  @Column({ field: 'requires_audit_log', type: DataType.BOOLEAN, allowNull: false })
  declare requiresAuditLog: boolean;

  @Column({ field: 'requires_regression_test', type: DataType.BOOLEAN, allowNull: false })
  declare requiresRegressionTest: boolean;

  @Column({ field: 'requires_stress_test', type: DataType.BOOLEAN, allowNull: false })
  declare requiresStressTest: boolean;

  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'detected_from', type: DataType.STRING(80), allowNull: false })
  declare detectedFrom: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
