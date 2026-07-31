/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'workflow_definitions', schema: atlasSchemaFor('workflow_definitions'), timestamps: false })
export class WorkflowDefinitionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'workflow_code', type: DataType.STRING(80), allowNull: false })
  declare workflowCode: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare version: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'process_type', type: DataType.STRING(60), allowNull: false })
  declare processType: string;

  @Column({ field: 'owner_domain', type: DataType.STRING(80), allowNull: false })
  declare ownerDomain: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'is_default', type: DataType.BOOLEAN, allowNull: false })
  declare isDefault: boolean;

  @Column({ field: 'entry_stage_code', type: DataType.STRING(80) })
  declare entryStageCode: string | null;

  @Column({ field: 'terminal_stage_codes', type: DataType.JSONB, allowNull: false })
  declare terminalStageCodes: string[];

  @Column({ field: 'success_criteria_json', type: DataType.JSONB, allowNull: false })
  declare successCriteria: Record<string, unknown>;

  @Column({ field: 'failure_criteria_json', type: DataType.JSONB, allowNull: false })
  declare failureCriteria: Record<string, unknown>;

  @Column({ field: 'metadata_json', type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare source: string;

  @Column({ field: 'effective_from', type: DataType.DATE })
  declare effectiveFrom: Date | null;

  @Column({ field: 'effective_until', type: DataType.DATE })
  declare effectiveUntil: Date | null;

  @Column({ field: 'created_by', type: DataType.STRING(120) })
  declare createdBy: string | null;

  @Column({ field: 'updated_by', type: DataType.STRING(120) })
  declare updatedBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
