/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'workflow_transitions', schema: atlasSchemaFor('workflow_transitions'), timestamps: false })
export class WorkflowTransitionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'workflow_definition_id', type: DataType.BIGINT, allowNull: false })
  declare workflowDefinitionId: string;

  @Column({ field: 'transition_code', type: DataType.STRING(140), allowNull: false })
  declare transitionCode: string;

  @Column({ field: 'from_step_id', type: DataType.BIGINT })
  declare fromStepId: string | null;

  @Column({ field: 'to_step_id', type: DataType.BIGINT })
  declare toStepId: string | null;

  @Column({ field: 'condition_type', type: DataType.STRING(40), allowNull: false })
  declare conditionType: string;

  @Column({ field: 'condition_expression_json', type: DataType.JSONB, allowNull: false })
  declare conditionExpression: Record<string, unknown>;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_default_path', type: DataType.BOOLEAN, allowNull: false })
  declare isDefaultPath: boolean;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
