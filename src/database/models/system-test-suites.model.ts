import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_test_suites', timestamps: false })
export class SystemTestSuiteModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ type: DataType.STRING(180), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare module: string;

  @Column({ field: 'suite_type', type: DataType.STRING(40), allowNull: false })
  declare suiteType: string;

  @Column({ field: 'execution_mode', type: DataType.STRING(40), allowNull: false })
  declare executionMode: string;

  @Column({ field: 'environment_scope', type: DataType.JSONB, allowNull: false })
  declare environmentScope: string[];

  @Column({ field: 'is_enabled', type: DataType.BOOLEAN, allowNull: false })
  declare isEnabled: boolean;

  @Column({ field: 'requires_seed_data', type: DataType.BOOLEAN, allowNull: false })
  declare requiresSeedData: boolean;

  @Column({ field: 'is_safe_for_production', type: DataType.BOOLEAN, allowNull: false })
  declare isSafeForProduction: boolean;

  @Column({ field: 'requires_destructive_permission', type: DataType.BOOLEAN, allowNull: false })
  declare requiresDestructivePermission: boolean;

  @Column({ field: 'created_by', type: DataType.STRING(80) })
  declare createdBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
