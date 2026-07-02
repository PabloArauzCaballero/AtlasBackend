import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'watchlist_entries', timestamps: false })
export class WatchlistEntryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'scope', type: DataType.STRING(40) })
  declare scope: string | null;

  @Column({ field: 'country_code', type: DataType.STRING(3) })
  declare countryCode: string | null;

  @Column({ field: 'entity_type', type: DataType.STRING(80) })
  declare entityType: string | null;

  @Column({ field: 'entity_hash', type: DataType.STRING(128) })
  declare entityHash: string | null;

  @Column({ field: 'entity_last_4', type: DataType.STRING(4) })
  declare entityLast4: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: 'severity', type: DataType.STRING(40) })
  declare severity: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'created_by_type', type: DataType.STRING(40) })
  declare createdByType: string | null;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: 'created_by_platform_user_id', type: DataType.BIGINT })
  declare createdByPlatformUserId: string | null;

  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
