/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Qué opinó el cliente o el comercio de la atención recibida en su caso.
 * @system `support.support_case_feedback`; ningún agente puede modificar lo que su cliente respondió.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La opinión pertenece a quien la dio.
 *
 * La tabla no admite DELETE y el servicio nunca actualiza filas ajenas: una encuesta que el
 * evaluado puede corregir mide la disciplina del evaluado, no la calidad del servicio. El esfuerzo
 * (`effortScore`) va aparte de la satisfacción porque un caso puede resolverse bien y aun así haber
 * costado tres llamadas.
 */
@Table({ tableName: 'support_case_feedback', schema: atlasSchemaFor('support_case_feedback'), timestamps: false })
export class SupportCaseFeedbackModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'respondent_actor_type', type: DataType.STRING(30), allowNull: false })
  declare respondentActorType: string;

  @Column({ field: 'respondent_actor_id', type: DataType.STRING(64), allowNull: false })
  declare respondentActorId: string;

  @Column({ field: 'csat_score', type: DataType.SMALLINT, allowNull: false })
  declare csatScore: number;

  @Column({ field: 'effort_score', type: DataType.SMALLINT })
  declare effortScore: number | null;

  @Column({ field: 'comment', type: DataType.TEXT })
  declare comment: string | null;

  @Column({ field: 'submitted_at', type: DataType.DATE, allowNull: false })
  declare submittedAt: Date;
}
