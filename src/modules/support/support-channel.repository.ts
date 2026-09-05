/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Guarda la sesión de atención y quién estuvo dentro de ella, con su entrada y su salida.
 * @system escribe `support_channels` y `support_channel_participants`; el canal no se borra, se cierra.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { InjectConnection } from '@nestjs/sequelize';
import { CreationAttributes, literal, Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportChannelModel, SupportChannelParticipantModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const SCHEMA = atlasSchemaFor('support_channels');
const CHANNELS = `${SCHEMA}.support_channels`;
const PARTICIPANTS = `${SCHEMA}.support_channel_participants`;
const MESSAGES = `${SCHEMA}.support_messages`;

export type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class SupportChannelRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(SupportChannelModel) private readonly channels: typeof SupportChannelModel,
    @InjectModel(SupportChannelParticipantModel) private readonly participants: typeof SupportChannelParticipantModel,
  ) {}

  create(values: CreationAttributes<SupportChannelModel>, options: RepositoryOptions = {}): Promise<SupportChannelModel> {
    return this.channels.create(values, { transaction: options.transaction });
  }

  findById(tenantId: string, channelId: string, options: RepositoryOptions = {}): Promise<SupportChannelModel | null> {
    return this.channels.findOne({ where: { tenantId, id: channelId, deleted: false }, transaction: options.transaction });
  }

  async requireById(tenantId: string, channelId: string, options: RepositoryOptions = {}): Promise<SupportChannelModel> {
    const channel = await this.findById(tenantId, channelId, options);
    if (!channel) throw new NotFoundException({ code: 'SUPPORT_CHANNEL_NOT_FOUND', channelId });
    return channel;
  }

  async update(tenantId: string, channelId: string, values: Partial<SupportChannelModel>, options: RepositoryOptions = {}): Promise<void> {
    await this.channels.update({ ...values, updatedAtValue: new Date() } as Partial<SupportChannelModel>, {
      where: { tenantId, id: channelId },
      transaction: options.transaction,
    });
  }

  /**
   * El canal vivo del mismo cliente, si lo hay.
   *
   * Abrir soporte dos veces desde dos pantallas no debe crear dos conversaciones: el agente vería la
   * misma persona duplicada y contestaría dos veces lo mismo. Se reutiliza el canal abierto en vez
   * de bloquear con un error, porque el usuario no hizo nada malo.
   */
  findLiveChannelForCustomer(tenantId: string, customerId: string): Promise<SupportChannelModel | null> {
    return this.channels.findOne({
      where: {
        tenantId,
        subjectCustomerId: customerId,
        deleted: false,
        status: { [Op.in]: ['REQUESTED', 'QUEUED', 'OPEN', 'WAITING_USER', 'WAITING_AGENT'] },
      },
      order: [['requested_at', 'DESC']],
    });
  }

  /**
   * El canal vivo de ESTE empleado del comercio, no el de su empresa.
   *
   * Se resuelve en dos consultas y no con un `include` porque los modelos de soporte no declaran
   * asociaciones: un `include` obligaría a cablear `@HasMany` en ambos sentidos y a que el registro
   * de Sequelize las resuelva al arrancar, para ahorrar una consulta indexada por `actorId`. Dos
   * empleados del mismo comercio deben poder tener conversaciones distintas a la vez.
   */
  async findLiveChannelForPartnerUser(tenantId: string, partnerProfileId: string, actorId: string): Promise<SupportChannelModel | null> {
    const live = await this.participants.findAll({
      where: { tenantId, actorId, roleInChannel: 'REQUESTER', leftAt: null },
      order: [['joined_at', 'DESC']],
      limit: 20,
    });
    if (!live.length) return null;

    return this.channels.findOne({
      where: {
        tenantId,
        subjectPartnerProfileId: partnerProfileId,
        deleted: false,
        id: { [Op.in]: live.map((participant) => participant.channelId) },
        status: { [Op.in]: ['REQUESTED', 'QUEUED', 'OPEN', 'WAITING_USER', 'WAITING_AGENT'] },
      },
      order: [['requested_at', 'DESC']],
    });
  }

  listChannelsForCase(caseId: string): Promise<SupportChannelModel[]> {
    return this.channels.findAll({ where: { caseId, deleted: false }, order: [['requested_at', 'DESC']] });
  }

  /** La cola de espera: canales encolados sin agente, en orden de llegada. */
  listQueuedChannels(tenantId: string, queueId: string | null, limit = 50): Promise<SupportChannelModel[]> {
    return this.channels.findAll({
      where: {
        tenantId,
        deleted: false,
        status: { [Op.in]: ['REQUESTED', 'QUEUED'] },
        ...(queueId ? { queueId } : {}),
      },
      order: [['requested_at', 'ASC']],
      limit,
    });
  }

  addParticipant(
    values: CreationAttributes<SupportChannelParticipantModel>,
    options: RepositoryOptions = {},
  ): Promise<SupportChannelParticipantModel> {
    return this.participants.create(values, { transaction: options.transaction });
  }

  listParticipants(channelId: string, options: RepositoryOptions = {}): Promise<SupportChannelParticipantModel[]> {
    return this.participants.findAll({ where: { channelId }, order: [['joined_at', 'ASC']], transaction: options.transaction });
  }

  /**
   * Quién está dentro AHORA. Es la comprobación de autorización de cada lectura del transcript.
   *
   * Se mira la participación viva y no el rol del token: un agente con permiso de soporte no debe
   * poder leer cualquier conversación por el hecho de ser agente, sino la que le fue asignada.
   */
  findLiveParticipant(
    channelId: string,
    actorType: string,
    actorId: string,
    options: RepositoryOptions = {},
  ): Promise<SupportChannelParticipantModel | null> {
    return this.participants.findOne({
      where: { channelId, actorType, actorId, leftAt: null },
      transaction: options.transaction,
    });
  }

  async removeParticipant(
    channelId: string,
    actorType: string,
    actorId: string,
    leaveReason: string,
    options: RepositoryOptions = {},
  ): Promise<void> {
    await this.participants.update(
      { leftAt: new Date(), leaveReason },
      { where: { channelId, actorType, actorId, leftAt: null }, transaction: options.transaction },
    );
  }

  /**
   * Marca hasta dónde leyó una parte. Sólo avanza, nunca retrocede.
   *
   * El `GREATEST` no es cosmético: los acuses llegan fuera de orden en cuanto hay reconexión, y sin
   * él un ack viejo haría reaparecer como «sin leer» algo que la persona ya vio. En un chat eso se
   * percibe como que la aplicación pierde el hilo.
   */
  async markRead(input: {
    channelId: string;
    actorType: string;
    actorId: string;
    upToSequence: string;
  }): Promise<void> {
    await this.participants.update(
      {
        lastReadSequence: literal(`GREATEST(last_read_sequence, ${Number(input.upToSequence) || 0})`) as unknown as string,
        lastReadAt: new Date(),
        lastSeenAt: new Date(),
      },
      { where: { channelId: input.channelId, actorType: input.actorType, actorId: input.actorId, leftAt: null } },
    );
  }

  /** Deja constancia de que esta parte tiene la conversación abierta ahora. */
  async touchSeen(channelId: string, actorType: string, actorId: string): Promise<void> {
    await this.participants.update(
      { lastSeenAt: new Date() },
      { where: { channelId, actorType, actorId, leftAt: null } },
    );
  }

  /**
   * Hasta dónde ha leído LA OTRA parte: es el doble tic del que envió.
   *
   * Se excluye a quien pregunta porque su propio puntero no le dice nada: lo que quiere saber es si
   * el otro lo vio.
   */
  async readStateOf(channelId: string, excludeActorType: string, excludeActorId: string) {
    const rows = await this.participants.findAll({
      where: { channelId, leftAt: null },
      order: [['joined_at', 'ASC']],
    });
    return rows
      .filter((row) => !(row.actorType === excludeActorType && row.actorId === excludeActorId))
      .map((row) => ({
        actorType: row.actorType,
        roleInChannel: row.roleInChannel,
        lastReadSequence: String(row.lastReadSequence ?? '0'),
        lastReadAt: row.lastReadAt ? new Date(row.lastReadAt).toISOString() : null,
        lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
      }));
  }

  /**
   * Cuántos mensajes sin leer tiene este actor, por conversación.
   *
   * Es una RESTA contra el contador del canal, no un contador propio que alguien tenga que mantener
   * al día. Los mensajes internos no cuentan para el cliente: se descuentan de la cifra porque
   * tampoco los puede ver, y un «tienes 3 sin leer» que abre una conversación sin novedades es la
   * forma más rápida de que la gente deje de mirar el aviso.
   */
  async unreadByChannel(input: { tenantId: string; actorType: string; actorId: string; publicOnly: boolean }) {
    const rows = await this.sequelize.query<{ channel_id: string; unread: string; last_message_sequence: string }>(
      `SELECT p.channel_id,
              GREATEST(
                (SELECT count(*) FROM ${MESSAGES} m
                  WHERE m.channel_id = p.channel_id
                    AND m.server_sequence > p.last_read_sequence
                    AND (:publicOnly = FALSE OR m.visibility <> 'INTERNAL')
                    AND NOT (m.sender_actor_type = :actorType AND m.sender_actor_id = :actorId)), 0)::text AS unread,
              c.last_message_sequence::text AS last_message_sequence
         FROM ${PARTICIPANTS} p
         JOIN ${CHANNELS} c ON c._id = p.channel_id
        WHERE p._tenant_id = :tenantId
          AND p.actor_type = :actorType
          AND p.actor_id = :actorId
          AND p.left_at IS NULL
          AND c._deleted = FALSE;`,
      {
        replacements: { tenantId: input.tenantId, actorType: input.actorType, actorId: input.actorId, publicOnly: input.publicOnly },
        type: QueryTypes.SELECT,
      },
    );
    return rows.map((row) => ({
      channelId: String(row.channel_id),
      unread: Number(row.unread),
      lastMessageSequence: String(row.last_message_sequence),
    }));
  }
}
