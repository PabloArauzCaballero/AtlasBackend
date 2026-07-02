import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_items', timestamps: false })
export class ContextItemModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'catalog_version_id', type: DataType.BIGINT })
  declare catalogVersionId: string | null;

  @Column({ field: 'item_code', type: DataType.STRING(140) })
  declare itemCode: string | null;

  @Column({ field: 'item_name', type: DataType.STRING(220) })
  declare itemName: string | null;

  @Column({ field: 'item_type', type: DataType.STRING(80) })
  declare itemType: string | null;

  @Column({ field: 'attributes_json', type: DataType.JSONB })
  declare attributesJson: Record<string, unknown> | null;

  @Column({ field: 'source_id', type: DataType.BIGINT })
  declare sourceId: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
