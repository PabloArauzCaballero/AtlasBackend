import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_test_step_runs', timestamps: false })
export class SystemTestStepRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'test_run_id', type: DataType.BIGINT, allowNull: false })
  declare testRunId: string;

  @Column({ field: 'step_id', type: DataType.BIGINT, allowNull: false })
  declare stepId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'request_payload_sanitized', type: DataType.JSONB, allowNull: false })
  declare requestPayloadSanitized: Record<string, unknown>;

  @Column({ field: 'response_body_sanitized', type: DataType.JSONB, allowNull: false })
  declare responseBodySanitized: Record<string, unknown>;

  @Column({ field: 'status_code', type: DataType.INTEGER })
  declare statusCode: number | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
