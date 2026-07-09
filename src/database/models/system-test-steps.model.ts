import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_test_steps', timestamps: false })
export class SystemTestStepModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'suite_id', type: DataType.BIGINT, allowNull: false })
  declare suiteId: string;

  @Column({ field: 'endpoint_id', type: DataType.BIGINT })
  declare endpointId: string | null;

  @Column({ field: 'step_order', type: DataType.INTEGER, allowNull: false })
  declare stepOrder: number;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare name: string;

  @Column({ field: 'input_mode', type: DataType.STRING(40), allowNull: false })
  declare inputMode: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare method: string;

  @Column({ field: 'path_template', type: DataType.TEXT, allowNull: false })
  declare pathTemplate: string;

  @Column({ field: 'default_headers', type: DataType.JSONB, allowNull: false })
  declare defaultHeaders: Record<string, unknown>;

  @Column({ field: 'default_payload', type: DataType.JSONB, allowNull: false })
  declare defaultPayload: Record<string, unknown>;

  @Column({ field: 'config_schema', type: DataType.JSONB, allowNull: false })
  declare configSchema: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare extractors: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare assertions: Record<string, unknown>;

  @Column({ field: 'continue_on_failure', type: DataType.BOOLEAN, allowNull: false })
  declare continueOnFailure: boolean;

  @Column({ field: 'cleanup_required', type: DataType.BOOLEAN, allowNull: false })
  declare cleanupRequired: boolean;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
