import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_job_runs', timestamps: false })
export class SystemJobRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'job_code', type: DataType.STRING(120), allowNull: false })
  declare jobCode: string;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @Column({ field: 'input_json', type: DataType.JSONB })
  declare inputJson: Record<string, unknown> | null;

  @Column({ field: 'result_json', type: DataType.JSONB })
  declare resultJson: Record<string, unknown> | null;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: 'triggered_by_type', type: DataType.STRING(40) })
  declare triggeredByType: string | null;

  @Column({ field: 'triggered_by_id', type: DataType.STRING(120) })
  declare triggeredById: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
