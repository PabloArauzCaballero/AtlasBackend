import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'schema_constraint_notes', timestamps: false })
export class SchemaConstraintNoteModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'table_name', type: DataType.STRING(120) })
  declare tableName: string | null;

  @Column({ field: 'constraint_type', type: DataType.STRING(60) })
  declare constraintType: string | null;

  @Column({ field: 'constraint_expression', type: DataType.TEXT })
  declare constraintExpression: string | null;

  @Column({ field: 'rationale', type: DataType.TEXT })
  declare rationale: string | null;

  @Column({ field: 'build_phase', type: DataType.STRING(40) })
  declare buildPhase: string | null;

  @Column({ field: 'is_required_for_mvp', type: DataType.BOOLEAN })
  declare isRequiredForMvp: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
