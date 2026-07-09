import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'internal_users', timestamps: false })
export class InternalUserModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'user_code', type: DataType.STRING(60) })
  declare userCode: string | null;

  @Column({ field: 'full_name', type: DataType.STRING(180) })
  declare fullName: string | null;

  @Column({ field: 'email', type: DataType.STRING(180) })
  declare email: string | null;

  @Column({ field: 'role_code', type: DataType.STRING(80) })
  declare roleCode: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'department', type: DataType.STRING(40) })
  declare department: string | null;

  @Column({ field: 'job_title', type: DataType.STRING(120) })
  declare jobTitle: string | null;

  @Column({ field: 'last_login_at', type: DataType.DATE })
  declare lastLoginAt: Date | null;

  @Column({ field: 'password_changed_at', type: DataType.DATE })
  declare passwordChangedAt: Date | null;

  @Column({ field: 'must_change_password', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare mustChangePassword: boolean;

  @Column({ field: 'mfa_enabled', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare mfaEnabled: boolean;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: 'updated_by_internal_user_id', type: DataType.BIGINT })
  declare updatedByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
