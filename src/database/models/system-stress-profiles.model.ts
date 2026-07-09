import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_stress_profiles', timestamps: false })
export class SystemStressProfileModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'endpoint_id', type: DataType.BIGINT, allowNull: false })
  declare endpointId: string;

  @Column({ type: DataType.STRING(180), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare name: string;

  @Column({ field: 'target_rps', type: DataType.INTEGER, allowNull: false })
  declare targetRps: number;

  @Column({ field: 'duration_seconds', type: DataType.INTEGER, allowNull: false })
  declare durationSeconds: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare concurrency: number;

  @Column({ field: 'environment_scope', type: DataType.JSONB, allowNull: false })
  declare environmentScope: string[];

  @Column({ field: 'max_error_rate', type: DataType.FLOAT, allowNull: false })
  declare maxErrorRate: number;

  @Column({ field: 'max_p95_ms', type: DataType.INTEGER, allowNull: false })
  declare maxP95Ms: number;

  @Column({ field: 'is_enabled', type: DataType.BOOLEAN, allowNull: false })
  declare isEnabled: boolean;

  @Column({ field: 'requires_approval', type: DataType.BOOLEAN, allowNull: false })
  declare requiresApproval: boolean;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'created_by', type: DataType.STRING(80) })
  declare createdBy: string | null;

  @Column({ field: 'updated_by', type: DataType.STRING(80) })
  declare updatedBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
