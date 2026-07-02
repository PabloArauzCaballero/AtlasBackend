import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_sources', timestamps: false })
export class ContextSourceModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'source_code', type: DataType.STRING(80) })
  declare sourceCode: string | null;

  @Column({ field: 'source_name', type: DataType.STRING(180) })
  declare sourceName: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'reliability_score', type: DataType.DECIMAL(5, 2) })
  declare reliabilityScore: string | null;

  @Column({ field: 'refresh_frequency', type: DataType.STRING(60) })
  declare refreshFrequency: string | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
