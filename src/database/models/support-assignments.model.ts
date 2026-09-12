/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Quién fue responsable del caso, desde cuándo, por qué y hasta cuándo.
 * @system `support.support_assignments`, historial completo: una sola asignación viva por caso.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La responsabilidad es un intervalo, no un campo.
 *
 * Guardar sólo `current_assignee` en el caso perdería que estuvo dos horas en otra cola antes de
 * llegar aquí — y con ello la razón por la que se incumplió el SLA. El índice parcial sobre
 * `releasedAt IS NULL` impone que sólo una esté viva: una transferencia a medias dejaría a dos
 * agentes creyendo que el caso es suyo.
 */
@Table({ tableName: 'support_assignments', schema: atlasSchemaFor('support_assignments'), timestamps: false })
export class SupportAssignmentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'channel_id', type: DataType.BIGINT })
  declare channelId: string | null;

  @Column({ field: 'assignee_type', type: DataType.STRING(20), allowNull: false })
  declare assigneeType: string;

  @Column({ field: 'assignee_agent_profile_id', type: DataType.BIGINT })
  declare assigneeAgentProfileId: string | null;

  @Column({ field: 'assignee_queue_id', type: DataType.BIGINT })
  declare assigneeQueueId: string | null;

  @Column({ field: 'assigned_at', type: DataType.DATE, allowNull: false })
  declare assignedAt: Date;

  @Column({ field: 'released_at', type: DataType.DATE })
  declare releasedAt: Date | null;

  @Column({ field: 'assignment_reason', type: DataType.STRING(200), allowNull: false })
  declare assignmentReason: string;

  @Column({ field: 'release_reason', type: DataType.STRING(200) })
  declare releaseReason: string | null;

  @Column({ field: 'assigned_by_actor_id', type: DataType.STRING(64) })
  declare assignedByActorId: string | null;

  @Column({ field: 'assignment_version', type: DataType.INTEGER, allowNull: false })
  declare assignmentVersion: number;
}
