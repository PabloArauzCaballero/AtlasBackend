import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'internal_role_permissions', timestamps: false })
export class InternalRolePermissionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'role_id', type: DataType.BIGINT, allowNull: false })
  declare roleId: string;

  @Column({ field: 'permission_id', type: DataType.BIGINT, allowNull: false })
  declare permissionId: string;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
