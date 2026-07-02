import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'manual_review_cases', timestamps: false })
export class ManualReviewCaseModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_code', type: DataType.STRING(80) })
  declare caseCode: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'fraud_case_id', type: DataType.BIGINT })
  declare fraudCaseId: string | null;

  @Column({ field: 'case_type', type: DataType.STRING(80) })
  declare caseType: string | null;

  @Column({ field: 'priority', type: DataType.STRING(40) })
  declare priority: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'assigned_to_internal_user_id', type: DataType.BIGINT })
  declare assignedToInternalUserId: string | null;

  @Column({ field: 'opened_at', type: DataType.DATE })
  declare openedAt: Date | null;

  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @Column({ field: 'resolution', type: DataType.STRING(80) })
  declare resolution: string | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
