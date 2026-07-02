import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'platform_users', timestamps: false })
export class PlatformUserModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

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

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
