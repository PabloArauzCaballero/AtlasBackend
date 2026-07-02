import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'operational_audit_logs', timestamps: false })
export class OperationalAuditLogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40) })
  declare actorType: string | null;

  @Column({ field: 'actor_internal_user_id', type: DataType.BIGINT })
  declare actorInternalUserId: string | null;

  @Column({ field: 'actor_platform_user_id', type: DataType.BIGINT })
  declare actorPlatformUserId: string | null;

  @Column({ field: 'action_code', type: DataType.STRING(120) })
  declare actionCode: string | null;

  @Column({ field: 'target_type', type: DataType.STRING(120) })
  declare targetType: string | null;

  @Column({ field: 'target_id', type: DataType.STRING(120) })
  declare targetId: string | null;

  @Column({ field: 'ip_address', type: DataType.INET })
  declare ipAddress: string | null;

  @Column({ field: 'user_agent', type: DataType.TEXT })
  declare userAgent: string | null;

  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: Record<string, unknown> | null;

  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
