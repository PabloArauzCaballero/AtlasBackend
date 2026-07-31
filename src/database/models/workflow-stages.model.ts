/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'workflow_stages', schema: atlasSchemaFor('workflow_stages'), timestamps: false })
export class WorkflowStageModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'workflow_definition_id', type: DataType.BIGINT, allowNull: false })
  declare workflowDefinitionId: string;

  @Column({ field: 'parent_stage_id', type: DataType.BIGINT })
  declare parentStageId: string | null;

  @Column({ field: 'stage_code', type: DataType.STRING(80), allowNull: false })
  declare stageCode: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'module_code', type: DataType.STRING(80), allowNull: false })
  declare moduleCode: string;

  @Column({ field: 'actor_type', type: DataType.STRING(40), allowNull: false })
  declare actorType: string;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_optional', type: DataType.BOOLEAN, allowNull: false })
  declare isOptional: boolean;

  @Column({ field: 'is_entry_stage', type: DataType.BOOLEAN, allowNull: false })
  declare isEntryStage: boolean;

  @Column({ field: 'is_terminal_stage', type: DataType.BOOLEAN, allowNull: false })
  declare isTerminalStage: boolean;

  @Column({ field: 'allowed_roles_json', type: DataType.JSONB, allowNull: false })
  declare allowedRoles: string[];

  @Column({ field: 'required_states_json', type: DataType.JSONB, allowNull: false })
  declare requiredStates: string[];

  @Column({ field: 'resulting_states_json', type: DataType.JSONB, allowNull: false })
  declare resultingStates: string[];

  @Column({ field: 'completion_rule_json', type: DataType.JSONB, allowNull: false })
  declare completionRule: Record<string, unknown>;

  @Column({ field: 'metadata_json', type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
