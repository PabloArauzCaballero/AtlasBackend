import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'permission_events', timestamps: false })
export class PermissionEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'permission_code', type: DataType.STRING(80) })
  declare permissionCode: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE })
  declare requestedAt: Date | null;

  @Column({ field: 'granted', type: DataType.BOOLEAN })
  declare granted: boolean | null;

  @Column({ field: 'responded_at', type: DataType.DATE })
  declare respondedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
