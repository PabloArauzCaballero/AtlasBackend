import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_catalogs', timestamps: false })
export class ContextCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'catalog_code', type: DataType.STRING(80) })
  declare catalogCode: string | null;

  @Column({ field: 'catalog_name', type: DataType.STRING(180) })
  declare catalogName: string | null;

  @Column({ field: 'domain', type: DataType.STRING(80) })
  declare domain: string | null;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'owner_team', type: DataType.STRING(80) })
  declare ownerTeam: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
