import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'internal_user_roles', timestamps: false })
export class InternalUserRoleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'internal_user_id', type: DataType.BIGINT, allowNull: false })
  declare internalUserId: string;

  @Column({ field: 'role_id', type: DataType.BIGINT, allowNull: false })
  declare roleId: string;

  @Column({ field: 'assigned_by_internal_user_id', type: DataType.BIGINT })
  declare assignedByInternalUserId: string | null;

  @Column({ field: 'assigned_at', type: DataType.DATE, allowNull: false })
  declare assignedAt: Date;

  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;

  @Column({ field: 'revoked_by_internal_user_id', type: DataType.BIGINT })
  declare revokedByInternalUserId: string | null;

  @Column({ field: 'revocation_reason', type: DataType.TEXT })
  declare revocationReason: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
