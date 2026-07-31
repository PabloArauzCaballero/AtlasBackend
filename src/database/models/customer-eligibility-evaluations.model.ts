/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Evidencia de cada evaluación de habilitación crediticia. Append-only: nunca se actualiza una fila.
 *
 * Existe para responder con un SELECT —y no con una investigación— la pregunta "¿por qué este
 * cliente quedó habilitado (u observado, o bloqueado) el día X?". Guarda el resultado, los
 * bloqueadores encontrados, la versión de la regla aplicada y un hash de los insumos, de modo que
 * una evaluación pasada se pueda explicar aunque la regla haya cambiado desde entonces.
 */
@Table({
  tableName: 'customer_eligibility_evaluations',
  schema: atlasSchemaFor('customer_eligibility_evaluations'),
  timestamps: false,
})
export class CustomerEligibilityEvaluationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'eligible', type: DataType.BOOLEAN, allowNull: false })
  declare eligible: boolean;

  @Column({ field: 'lifecycle_status', type: DataType.STRING(40), allowNull: false })
  declare lifecycleStatus: string;

  @Column({ field: 'rule_version', type: DataType.STRING(40), allowNull: false })
  declare ruleVersion: string;

  @Column({ field: 'blockers_json', type: DataType.JSONB, allowNull: false })
  declare blockersJson: unknown;

  @Column({ field: 'facts_hash', type: DataType.STRING(128), allowNull: false })
  declare factsHash: string;

  @Column({ field: 'evaluated_by_type', type: DataType.STRING(40), allowNull: false })
  declare evaluatedByType: string;

  @Column({ field: 'evaluated_by_internal_user_id', type: DataType.BIGINT })
  declare evaluatedByInternalUserId: string | null;

  @Column({ field: 'decision_source', type: DataType.STRING(40), allowNull: false })
  declare decisionSource: string;

  @Column({ field: 'reason_code', type: DataType.STRING(120) })
  declare reasonCode: string | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'evaluated_at', type: DataType.DATE, allowNull: false })
  declare evaluatedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
