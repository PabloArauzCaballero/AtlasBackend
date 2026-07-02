import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'onboarding_flows', timestamps: false })
export class OnboardingFlowModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'flow_version', type: DataType.STRING(80) })
  declare flowVersion: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @Column({ field: 'abandoned_at', type: DataType.DATE })
  declare abandonedAt: Date | null;

  @Column({ field: 'completion_status', type: DataType.STRING(40) })
  declare completionStatus: string | null;

  @Column({ field: 'total_duration_seconds', type: DataType.INTEGER })
  declare totalDurationSeconds: number | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
