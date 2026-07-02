import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'tenants', timestamps: false })
export class TenantModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'tenant_code', type: DataType.STRING(60) })
  declare tenantCode: string | null;

  @Column({ field: 'legal_name', type: DataType.STRING(180) })
  declare legalName: string | null;

  @Column({ field: 'country_code', type: DataType.STRING(3) })
  declare countryCode: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
