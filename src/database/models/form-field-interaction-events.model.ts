import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'form_field_interaction_events', timestamps: false })
export class FormFieldInteractionEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'field_code', type: DataType.STRING(100) })
  declare fieldCode: string | null;

  @Column({ field: 'interaction_type', type: DataType.STRING(60) })
  declare interactionType: string | null;

  @Column({ field: 'used_copy_paste', type: DataType.BOOLEAN })
  declare usedCopyPaste: boolean | null;

  @Column({ field: 'correction_count', type: DataType.INTEGER })
  declare correctionCount: number | null;

  @Column({ field: 'focus_duration_ms', type: DataType.INTEGER })
  declare focusDurationMs: number | null;

  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
