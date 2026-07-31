/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'workflow_steps', schema: atlasSchemaFor('workflow_steps'), timestamps: false })
export class WorkflowStepModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'workflow_definition_id', type: DataType.BIGINT, allowNull: false })
  declare workflowDefinitionId: string;

  @Column({ field: 'workflow_stage_id', type: DataType.BIGINT, allowNull: false })
  declare workflowStageId: string;

  @Column({ field: 'step_code', type: DataType.STRING(120), allowNull: false })
  declare stepCode: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'endpoint_code', type: DataType.STRING(180), allowNull: false })
  declare endpointCode: string;

  @Column({ field: 'http_method', type: DataType.STRING(10), allowNull: false })
  declare httpMethod: string;

  @Column({ field: 'route_path', type: DataType.TEXT, allowNull: false })
  declare routePath: string;

  @Column({ field: 'execution_order', type: DataType.INTEGER, allowNull: false })
  declare executionOrder: number;

  @Column({ field: 'is_mandatory', type: DataType.BOOLEAN, allowNull: false })
  declare isMandatory: boolean;

  @Column({ field: 'is_repeatable', type: DataType.BOOLEAN, allowNull: false })
  declare isRepeatable: boolean;

  @Column({ field: 'requires_idempotency_key', type: DataType.BOOLEAN, allowNull: false })
  declare requiresIdempotencyKey: boolean;

  @Column({ field: 'requires_auth', type: DataType.BOOLEAN, allowNull: false })
  declare requiresAuth: boolean;

  @Column({ field: 'is_flow_entry', type: DataType.BOOLEAN, allowNull: false })
  declare isFlowEntry: boolean;

  @Column({ field: 'is_flow_exit', type: DataType.BOOLEAN, allowNull: false })
  declare isFlowExit: boolean;

  @Column({ field: 'allowed_roles_json', type: DataType.JSONB, allowNull: false })
  declare allowedRoles: string[];

  @Column({ field: 'required_states_json', type: DataType.JSONB, allowNull: false })
  declare requiredStates: string[];

  @Column({ field: 'resulting_states_json', type: DataType.JSONB, allowNull: false })
  declare resultingStates: string[];

  @Column({ field: 'input_contract_json', type: DataType.JSONB, allowNull: false })
  declare inputContract: Record<string, unknown>;

  @Column({ field: 'output_contract_json', type: DataType.JSONB, allowNull: false })
  declare outputContract: Record<string, unknown>;

  @Column({ field: 'validation_rules_json', type: DataType.JSONB, allowNull: false })
  declare validationRules: unknown[];

  @Column({ field: 'possible_errors_json', type: DataType.JSONB, allowNull: false })
  declare possibleErrors: unknown[];

  @Column({ field: 'retry_strategy_json', type: DataType.JSONB, allowNull: false })
  declare retryStrategy: Record<string, unknown>;

  @Column({ field: 'produces_events_json', type: DataType.JSONB, allowNull: false })
  declare producesEvents: string[];

  @Column({ field: 'consumes_events_json', type: DataType.JSONB, allowNull: false })
  declare consumesEvents: string[];

  @Column({ field: 'success_criteria_json', type: DataType.JSONB, allowNull: false })
  declare successCriteria: Record<string, unknown>;

  @Column({ field: 'failure_criteria_json', type: DataType.JSONB, allowNull: false })
  declare failureCriteria: Record<string, unknown>;

  @Column({ field: 'metadata_json', type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
