import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_catalog_versions', timestamps: false })
export class ContextCatalogVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'catalog_id', type: DataType.BIGINT })
  declare catalogId: string | null;

  @Column({ field: 'version_code', type: DataType.STRING(60) })
  declare versionCode: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'valid_from', type: DataType.DATEONLY })
  declare validFrom: string | null;

  @Column({ field: 'valid_until', type: DataType.DATEONLY })
  declare validUntil: string | null;

  @Column({ field: 'created_by_type', type: DataType.STRING(40) })
  declare createdByType: string | null;

  @Column({ field: 'created_by_platform_user_id', type: DataType.BIGINT })
  declare createdByPlatformUserId: string | null;

  @Column({ field: 'approved_by_type', type: DataType.STRING(40) })
  declare approvedByType: string | null;

  @Column({ field: 'approved_by_platform_user_id', type: DataType.BIGINT })
  declare approvedByPlatformUserId: string | null;

  @Column({ field: 'approved_at', type: DataType.DATE })
  declare approvedAt: Date | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
