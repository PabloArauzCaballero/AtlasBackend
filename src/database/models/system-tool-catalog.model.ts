import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_tool_catalog', timestamps: false })
export class SystemToolCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(220), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare type: string;

  @Column({ type: DataType.STRING(160) })
  declare provider: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare purpose: string;

  @Column({ field: 'required_env_vars', type: DataType.JSONB, allowNull: false })
  declare requiredEnvVars: string[];

  @Column({ field: 'has_sandbox', type: DataType.BOOLEAN, allowNull: false })
  declare hasSandbox: boolean;

  @Column({ field: 'healthcheck_route', type: DataType.TEXT })
  declare healthcheckRoute: string | null;

  @Column({ field: 'requires_credentials', type: DataType.BOOLEAN, allowNull: false })
  declare requiresCredentials: boolean;

  @Column({ field: 'is_critical', type: DataType.BOOLEAN, allowNull: false })
  declare isCritical: boolean;

  @Column({ field: 'is_worker', type: DataType.BOOLEAN, allowNull: false })
  declare isWorker: boolean;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'owner_team', type: DataType.STRING(120), allowNull: false })
  declare ownerTeam: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
