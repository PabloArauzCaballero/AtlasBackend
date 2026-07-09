import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'internal_permissions', timestamps: false })
export class InternalPermissionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'permission_code', type: DataType.STRING(140), allowNull: false })
  declare permissionCode: string;

  @Column({ field: 'module_code', type: DataType.STRING(80), allowNull: false })
  declare moduleCode: string;

  @Column({ field: 'resource_code', type: DataType.STRING(100), allowNull: false })
  declare resourceCode: string;

  @Column({ field: 'action_code', type: DataType.STRING(80), allowNull: false })
  declare actionCode: string;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'risk_level', type: DataType.STRING(40), allowNull: false })
  declare riskLevel: string;

  @Column({ field: 'requires_reason', type: DataType.BOOLEAN, allowNull: false })
  declare requiresReason: boolean;

  @Column({ field: 'requires_mfa', type: DataType.BOOLEAN, allowNull: false })
  declare requiresMfa: boolean;

  @Column({ field: 'is_system_permission', type: DataType.BOOLEAN, allowNull: false })
  declare isSystemPermission: boolean;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
