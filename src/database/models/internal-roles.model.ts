import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'internal_roles', timestamps: false })
export class InternalRoleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'role_code', type: DataType.STRING(80), allowNull: false })
  declare roleCode: string;

  @Column({ field: 'role_name', type: DataType.STRING(140), allowNull: false })
  declare roleName: string;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'department', type: DataType.STRING(40) })
  declare department: string | null;

  @Column({ field: 'legacy_role_code', type: DataType.STRING(80), allowNull: false })
  declare legacyRoleCode: string;

  @Column({ field: 'is_system_role', type: DataType.BOOLEAN, allowNull: false })
  declare isSystemRole: boolean;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
