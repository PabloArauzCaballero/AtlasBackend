/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business La sesión de atención: dónde ocurre la conversación entre alguien y soporte.
 * @system `support.support_channels`, con el contador que ordena la transcripción y el hash del último mensaje.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El canal puede cerrarse sin que el caso se cierre — y casi siempre debe ser así.
 *
 * Quien cuelga el chat no está diciendo «ya está resuelto»: puede haberse quedado sin batería. Por
 * eso cerrar aquí sólo escribe `closedAt`, `closedByActorId` y un motivo, y el expediente sigue su
 * propio ciclo. `lastMessageSequence` es el contador que ordena la conversación: se lee y se
 * incrementa en la misma sentencia, y eso es lo que evita dos mensajes en la misma posición.
 */
@Table({ tableName: 'support_channels', schema: atlasSchemaFor('support_channels'), timestamps: false })
export class SupportChannelModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'channel_code', type: DataType.STRING(60), allowNull: false })
  declare channelCode: string;

  @Column({ field: 'case_id', type: DataType.BIGINT })
  declare caseId: string | null;

  @Column({ field: 'channel_type', type: DataType.STRING(30), allowNull: false })
  declare channelType: string;

  @Column({ field: 'subject_context_type', type: DataType.STRING(30), allowNull: false })
  declare subjectContextType: string;

  @Column({ field: 'subject_customer_id', type: DataType.BIGINT })
  declare subjectCustomerId: string | null;

  @Column({ field: 'subject_partner_profile_id', type: DataType.BIGINT })
  declare subjectPartnerProfileId: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'queue_id', type: DataType.BIGINT })
  declare queueId: string | null;

  @Column({ field: 'assigned_agent_profile_id', type: DataType.BIGINT })
  declare assignedAgentProfileId: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE, allowNull: false })
  declare requestedAt: Date;

  @Column({ field: 'opened_at', type: DataType.DATE })
  declare openedAt: Date | null;

  @Column({ field: 'first_response_at', type: DataType.DATE })
  declare firstResponseAt: Date | null;

  @Column({ field: 'last_activity_at', type: DataType.DATE, allowNull: false })
  declare lastActivityAt: Date;

  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @Column({ field: 'closed_by_actor_id', type: DataType.STRING(64) })
  declare closedByActorId: string | null;

  @Column({ field: 'close_reason', type: DataType.STRING(40) })
  declare closeReason: string | null;

  @Column({ field: 'last_message_sequence', type: DataType.BIGINT, allowNull: false })
  declare lastMessageSequence: string;

  @Column({ field: 'last_message_hash', type: DataType.CHAR(64) })
  declare lastMessageHash: string | null;

  @Column({ field: 'claim_version', type: DataType.INTEGER, allowNull: false })
  declare claimVersion: number;

  @Column({ field: 'locale', type: DataType.STRING(10), allowNull: false })
  declare locale: string;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
