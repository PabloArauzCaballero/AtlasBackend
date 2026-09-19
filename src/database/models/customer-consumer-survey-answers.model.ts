/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({
  tableName: 'customer_consumer_survey_answers',
  schema: atlasSchemaFor('customer_consumer_survey_answers'),
  timestamps: false,
})
export class CustomerConsumerSurveyAnswerModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'survey_version', type: DataType.STRING(40), allowNull: false })
  declare surveyVersion: string;

  @Column({ field: 'question_code', type: DataType.STRING(60), allowNull: false })
  declare questionCode: string;

  @Column({ field: 'answer_code', type: DataType.STRING(60) })
  declare answerCode: string | null;

  @Column({ field: 'answer_value', type: DataType.DECIMAL(14, 2) })
  declare answerValue: string | null;

  @Column({ field: 'answered_in_ms', type: DataType.INTEGER, allowNull: false })
  declare answeredInMs: number;

  @Column({ field: 'answered_at', type: DataType.DATE, allowNull: false })
  declare answeredAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
