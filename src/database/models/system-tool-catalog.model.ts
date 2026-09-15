/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'system_tool_catalog', schema: atlasSchemaFor('system_tool_catalog'), timestamps: false })
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

  /**
   * Metadata de gobierno de la herramienta. Las columnas existían en la tabla y el repositorio ya
   * las escribía, pero el modelo no las declaraba: Sequelize descartaba esos cinco campos en
   * silencio y toda herramienta quedaba con la metadata en NULL. El portal, que la pide, mostraba
   * el hueco como «sin documentar» — no porque nadie la hubiera escrito, sino porque no llegaba.
   */
  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'business_value', type: DataType.TEXT })
  declare businessValue: string | null;

  @Column({ field: 'technical_usage', type: DataType.TEXT })
  declare technicalUsage: string | null;

  @Column({ field: 'audit_notes', type: DataType.TEXT })
  declare auditNotes: string | null;

  @Column({ field: 'failure_risks', type: DataType.TEXT })
  declare failureRisks: string | null;

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
