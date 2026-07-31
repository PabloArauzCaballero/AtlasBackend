/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'workflow_step_dependencies', schema: atlasSchemaFor('workflow_step_dependencies'), timestamps: false })
export class WorkflowStepDependencyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'workflow_definition_id', type: DataType.BIGINT, allowNull: false })
  declare workflowDefinitionId: string;

  @Column({ field: 'step_id', type: DataType.BIGINT, allowNull: false })
  declare stepId: string;

  @Column({ field: 'depends_on_step_id', type: DataType.BIGINT, allowNull: false })
  declare dependsOnStepId: string;

  @Column({ field: 'dependency_type', type: DataType.STRING(40), allowNull: false })
  declare dependencyType: string;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
