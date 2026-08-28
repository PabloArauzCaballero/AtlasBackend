/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Escribe lo que se dijo, en orden y sin poder reescribirlo después.
 * @system append de `support_messages` con secuencia atómica, cadena de hash e idempotencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  SupportAttachmentModel,
  SupportMessageModel,
  SupportMessageRelationModel,
} from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { contentHashOf, messageIntegrityHash, verifyChain, type ChainVerification } from './domain/support-hash-chain.js';

const CHANNELS = `${atlasSchemaFor('support_channels')}.support_channels`;

export type RepositoryOptions = { transaction?: Transaction };

export interface AppendMessageInput {
  tenantId: string;
  channelId: string;
  clientMessageId: string;
  senderActorType: string;
  senderActorId: string;
  senderAgentProfileId: string | null;
  messageType: string;
  visibility: string;
  /** Lo que se mostrará. Puede venir ya redactado. */
  bodyText: string | null;
  /** El original cifrado, cuando la vista se redactó o el contenido es sensible. */
  bodyCiphertext: string | null;
  keyVersion: string | null;
  classification: string;
  /** Hash del contenido ORIGINAL, calculado antes de redactar. */
  originalBody: string;
  redactionReason: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
}

@Injectable()
export class SupportMessageRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(SupportMessageModel) private readonly messages: typeof SupportMessageModel,
    @InjectModel(SupportMessageRelationModel) private readonly relations: typeof SupportMessageRelationModel,
    @InjectModel(SupportAttachmentModel) private readonly attachments: typeof SupportAttachmentModel,
  ) {}

  findByClientId(channelId: string, clientMessageId: string, options: RepositoryOptions = {}): Promise<SupportMessageModel | null> {
    return this.messages.findOne({ where: { channelId, clientMessageId }, transaction: options.transaction });
  }

  /**
   * Añade un mensaje al canal. Es la operación más delicada del módulo.
   *
   * ## La secuencia se reserva con un UPDATE, no con un COUNT
   *
   * `UPDATE ... SET last_message_sequence = last_message_sequence + 1 RETURNING` bloquea la fila del
   * canal durante el incremento, así que dos mensajes simultáneos —el del cliente y el del agente—
   * obtienen números distintos y consecutivos. Contar filas primero y escribir después habría dado
   * a ambos el mismo número, y el índice único habría hecho fallar a uno de los dos con un error
   * que el usuario lee como «no se pudo enviar».
   *
   * ## El hash anterior se lee dentro de la misma transacción
   *
   * Porque la cadena tiene que reflejar el orden REAL de escritura. Leerlo fuera dejaría dos
   * mensajes apuntando al mismo padre y la verificación fallaría más tarde, señalando manipulación
   * donde sólo hubo concurrencia.
   *
   * ## Idempotencia
   *
   * Si el `clientMessageId` ya existía, se devuelve el mensaje que ya está. Reintentar por mala red
   * es lo normal en un móvil; duplicar la pregunta del cliente no lo es.
   */
  async append(input: AppendMessageInput, transaction: Transaction): Promise<{ message: SupportMessageModel; created: boolean }> {
    const existing = await this.findByClientId(input.channelId, input.clientMessageId, { transaction });
    if (existing) return { message: existing, created: false };

    const [row] = await this.sequelize.query<{ last_message_sequence: string; last_message_hash: string | null }>(
      `UPDATE ${CHANNELS}
          SET last_message_sequence = last_message_sequence + 1,
              last_activity_at = NOW(),
              _updated_at = NOW()
        WHERE _tenant_id = :tenantId AND _id = :channelId
      RETURNING last_message_sequence, last_message_hash;`,
      { replacements: { tenantId: input.tenantId, channelId: input.channelId }, type: QueryTypes.SELECT, transaction },
    );
    if (!row) throw new Error('SUPPORT_CHANNEL_NOT_FOUND');

    const serverSequence = String(row.last_message_sequence);
    const previousMessageHash = row.last_message_hash;
    const createdAt = new Date();
    const contentHash = contentHashOf(input.originalBody);
    const integrityHash = messageIntegrityHash({
      channelId: input.channelId,
      serverSequence,
      senderActorType: input.senderActorType,
      senderActorId: input.senderActorId,
      createdAtIso: createdAt.toISOString(),
      contentHash,
      previousMessageHash,
    });

    const message = await this.messages.create(
      {
        tenantId: input.tenantId,
        channelId: input.channelId,
        serverSequence,
        clientMessageId: input.clientMessageId,
        senderActorType: input.senderActorType,
        senderActorId: input.senderActorId,
        senderAgentProfileId: input.senderAgentProfileId,
        messageType: input.messageType,
        visibility: input.visibility,
        bodyText: input.bodyText,
        bodyCiphertext: input.bodyCiphertext,
        keyVersion: input.keyVersion,
        classification: input.classification,
        contentHash,
        previousMessageHash,
        integrityHash,
        redactedAt: input.redactionReason ? createdAt : null,
        redactionReason: input.redactionReason,
        correlationId: input.correlationId,
        metadataJson: input.metadata,
        createdAtValue: createdAt,
      } as CreationAttributes<SupportMessageModel>,
      { transaction },
    );

    await this.sequelize.query(
      `UPDATE ${CHANNELS} SET last_message_hash = :hash WHERE _tenant_id = :tenantId AND _id = :channelId;`,
      { replacements: { hash: integrityHash, tenantId: input.tenantId, channelId: input.channelId }, type: QueryTypes.UPDATE, transaction },
    );

    return { message, created: true };
  }

  /**
   * Transcripción paginada hacia atrás por `server_sequence`.
   *
   * Cursor y no OFFSET: una conversación de soporte puede tener miles de mensajes, y `OFFSET 5000`
   * obliga a Postgres a leer y descartar todo lo anterior en cada scroll.
   */
  listMessages(input: {
    channelId: string;
    beforeSequence?: string | null;
    limit: number;
    includeInternal: boolean;
  }): Promise<SupportMessageModel[]> {
    return this.messages.findAll({
      where: {
        channelId: input.channelId,
        ...(input.beforeSequence ? { serverSequence: { [Op.lt]: input.beforeSequence } } : {}),
        ...(input.includeInternal ? {} : { visibility: { [Op.in]: ['PUBLIC', 'SYSTEM'] } }),
      },
      order: [['server_sequence', 'DESC']],
      limit: input.limit,
    });
  }

  findById(tenantId: string, messageId: string, options: RepositoryOptions = {}): Promise<SupportMessageModel | null> {
    return this.messages.findOne({ where: { tenantId, id: messageId }, transaction: options.transaction });
  }

  createRelation(
    values: CreationAttributes<SupportMessageRelationModel>,
    options: RepositoryOptions = {},
  ): Promise<SupportMessageRelationModel> {
    return this.relations.create(values, { transaction: options.transaction });
  }

  listRelations(messageIds: readonly string[]): Promise<SupportMessageRelationModel[]> {
    if (!messageIds.length) return Promise.resolve([]);
    return this.relations.findAll({
      where: { [Op.or]: [{ messageId: { [Op.in]: messageIds } }, { relatedMessageId: { [Op.in]: messageIds } }] },
    });
  }

  createAttachment(values: CreationAttributes<SupportAttachmentModel>, options: RepositoryOptions = {}): Promise<SupportAttachmentModel> {
    return this.attachments.create(values, { transaction: options.transaction });
  }

  findAttachmentById(tenantId: string, attachmentId: string): Promise<SupportAttachmentModel | null> {
    return this.attachments.findOne({ where: { tenantId, id: attachmentId } });
  }

  listAttachments(messageIds: readonly string[]): Promise<SupportAttachmentModel[]> {
    if (!messageIds.length) return Promise.resolve([]);
    return this.attachments.findAll({ where: { messageId: { [Op.in]: messageIds } } });
  }

  /**
   * Recalcula la cadena completa del canal y dice dónde se rompió.
   *
   * Se ejecuta en la verificación periódica de integridad y al exportar un expediente. Un resultado
   * inválido no es un bug de datos: es un incidente de seguridad, porque significa que alguien
   * escribió en la base sorteando los triggers.
   */
  async verifyChannelChain(channelId: string): Promise<ChainVerification> {
    const rows = await this.messages.findAll({ where: { channelId }, order: [['server_sequence', 'ASC']] });
    return verifyChain(
      rows.map((message) => ({
        integrityHash: message.integrityHash,
        previousHash: message.previousMessageHash,
        recomputed: messageIntegrityHash({
          channelId: String(message.channelId),
          serverSequence: message.serverSequence,
          senderActorType: message.senderActorType,
          senderActorId: message.senderActorId,
          createdAtIso: new Date(message.createdAtValue).toISOString(),
          contentHash: message.contentHash,
          previousMessageHash: message.previousMessageHash,
        }),
      })),
    );
  }
}
