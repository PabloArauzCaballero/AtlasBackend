import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_item_aliases', timestamps: false })
export class ContextItemAliasModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'context_item_id', type: DataType.BIGINT })
  declare contextItemId: string | null;

  @Column({ field: 'alias_value', type: DataType.STRING(220) })
  declare aliasValue: string | null;

  @Column({ field: 'alias_type', type: DataType.STRING(60) })
  declare aliasType: string | null;

  @Column({ field: 'normalized_alias', type: DataType.STRING(220) })
  declare normalizedAlias: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
