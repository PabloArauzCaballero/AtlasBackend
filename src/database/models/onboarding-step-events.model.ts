import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'onboarding_step_events', timestamps: false })
export class OnboardingStepEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'step_code', type: DataType.STRING(100) })
  declare stepCode: string | null;

  @Column({ field: 'event_type', type: DataType.STRING(60) })
  declare eventType: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'ended_at', type: DataType.DATE })
  declare endedAt: Date | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @Column({ field: 'error_count', type: DataType.INTEGER })
  declare errorCount: number | null;

  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: Record<string, unknown> | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
