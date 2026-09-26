/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Quién estuvo dentro de la conversación, con qué papel, desde cuándo y hasta cuándo.
 * @system `support.support_channel_participants`; la entrada y la salida no se sobreescriben.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Estar dentro del canal es la autorización para leerlo.
 *
 * De ahí que la fila conserve `joinedAt` y `leftAt` en vez de borrarse al salir: un supervisor que
 * entró diez minutos a una conversación de un cliente dejó de poder leerla, pero el hecho de que
 * entró no desaparece. En una transferencia cálida los dos agentes conviven un momento, y eso
 * también tiene que quedar escrito.
 */
@Table({ tableName: 'support_channel_participants', schema: atlasSchemaFor('support_channel_participants'), timestamps: false })
export class SupportChannelParticipantModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'channel_id', type: DataType.BIGINT, allowNull: false })
  declare channelId: string;

  @Column({ field: 'actor_type', type: DataType.STRING(30), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_id', type: DataType.STRING(64), allowNull: false })
  declare actorId: string;

  @Column({ field: 'agent_profile_id', type: DataType.BIGINT })
  declare agentProfileId: string | null;

  @Column({ field: 'role_in_channel', type: DataType.STRING(30), allowNull: false })
  declare roleInChannel: string;

  @Column({ field: 'joined_at', type: DataType.DATE, allowNull: false })
  declare joinedAt: Date;

  @Column({ field: 'left_at', type: DataType.DATE })
  declare leftAt: Date | null;

  @Column({ field: 'join_reason', type: DataType.STRING(200) })
  declare joinReason: string | null;

  @Column({ field: 'leave_reason', type: DataType.STRING(200) })
  declare leaveReason: string | null;

  /**
   * Hasta qué mensaje leyó esta parte. Sólo avanza.
   *
   * Los no leídos son una resta contra `support_channels.last_message_sequence`, no un contador
   * aparte que haya que mantener sincronizado — y por eso no pueden desincronizarse.
   */
  /*
   * `defaultValue` además del DEFAULT de la base: sin él, Sequelize valida la columna como obligatoria
   * ANTES de llegar a Postgres y rechaza cualquier alta de participante que no la mencione —que son
   * todas, porque nadie se une a una conversación declarando por dónde va leyendo—. La base es la
   * autoridad del valor; esto sólo evita que el ORM se le adelante.
   */
  @Column({ field: 'last_read_sequence', type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  declare lastReadSequence: string;

  @Column({ field: 'last_read_at', type: DataType.DATE })
  declare lastReadAt: Date | null;

  /** Última vez que esta parte tuvo la conversación abierta. Alimenta el «en línea» aproximado. */
  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;
}
