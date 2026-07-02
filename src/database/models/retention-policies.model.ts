import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'retention_policies', timestamps: false })
export class RetentionPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'policy_code', type: DataType.STRING(80) })
  declare policyCode: string | null;

  @Column({ field: 'applies_to', type: DataType.STRING(80) })
  declare appliesTo: string | null;

  @Column({ field: 'retention_days', type: DataType.INTEGER })
  declare retentionDays: number | null;

  @Column({ field: 'post_retention_action', type: DataType.STRING(40) })
  declare postRetentionAction: string | null;

  @Column({ field: 'legal_basis', type: DataType.STRING(180) })
  declare legalBasis: string | null;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
