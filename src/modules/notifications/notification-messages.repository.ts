/**
 * @file Puerto de persistencia: mensajes de notificación (creación idempotente, consulta, reclamo y cancelación).
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { NotificationMessageModel } from '../../database/models/index.js';
import { ListMessagesQueryDto } from './notifications.schemas.js';
import { NotificationChannel, RecipientType } from './notification-types.js';
import { buildEncryptedDeliveryTargets } from './notification-delivery-targets.util.js';
import { ownedByGenericJobs } from './campaigns/notification-visibility.util.js';
import { withCreatedBetween, withTextSearch } from './notification-list.filters.js';

@Injectable()
export class NotificationMessagesRepository {
  constructor(@InjectModel(NotificationMessageModel) private readonly messageModel: typeof NotificationMessageModel) {}

  async createMessage(input: {
    tenantId: string | null;
    outboxEventId: string | null;
    recipientType: RecipientType;
    recipientId: string;
    channel: NotificationChannel;
    templateCode: string | null;
    subject: string | null;
    title: string | null;
    body: string;
    payload: Record<string, unknown>;
    priority: number;
    category?: string | null;
    icon?: string | null;
    scheduledAt?: Date | null;
    idempotencyKey?: string | null;
    correlationId?: string | null;
    causationId?: string | null;
  }): Promise<NotificationMessageModel> {
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
      if (existing) return existing;
    }
    const now = new Date();
    try {
      return await this.messageModel.create({
        tenantId: input.tenantId,
        outboxEventId: input.outboxEventId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: input.channel,
        templateCode: input.templateCode,
        subject: input.subject,
        title: input.title,
        body: input.body,
        payloadJson: redactSensitiveObject(input.payload) as Record<string, unknown>,
        deliveryTargetsJson: (await buildEncryptedDeliveryTargets(input.channel, input.payload)) as unknown as Array<
          Record<string, unknown>
        >,
        status: 'pending',
        priority: input.priority,
        category: input.category ?? null,
        icon: input.icon ?? null,
        scheduledAt: input.scheduledAt ?? now,
        queuedAt: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        cancelledAt: null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        createdAtValue: now,
        updatedAtValue: now,
      });
    } catch (error) {
      // El findOne de arriba no cierra la ventana de carrera: dos requests concurrentes con la
      // misma idempotencyKey pueden pasar ambas la comprobación y llegar al create. El índice único
      // parcial (ux_notification_messages_idempotency_key) garantiza que solo una gane; la perdedora
      // recibe UniqueConstraintError. En vez de propagarlo como 500, se relee el mensaje ganador y
      // se devuelve — el resultado observable es idéntico a si hubiera ganado el findOne.
      if (error instanceof UniqueConstraintError && input.idempotencyKey) {
        const winner = await this.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async findByIdempotencyKey(tenantId: string | null, idempotencyKey: string): Promise<NotificationMessageModel | null> {
    return this.messageModel.findOne({ where: { tenantId, idempotencyKey } });
  }

  async getMessage(tenantId: string, messageId: string): Promise<NotificationMessageModel> {
    const message = await this.messageModel.findOne({ where: { tenantId, id: messageId } });
    if (!message) throw new NotFoundException('NOTIFICATION_MESSAGE_NOT_FOUND');
    return message;
  }

  async getMessageForDelivery(messageId: string): Promise<NotificationMessageModel> {
    const message = await this.messageModel.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('NOTIFICATION_MESSAGE_NOT_FOUND');
    return message;
  }

  async listMessages(tenantId: string, query: ListMessagesQueryDto) {
    const where: Record<string | symbol, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    if (query.recipientType) where.recipientType = query.recipientType;
    if (query.recipientId) where.recipientId = query.recipientId;
    if (query.correlationId) where.correlationId = query.correlationId;
    withCreatedBetween(where, query);
    withTextSearch(where, query.q, ['correlationId', 'templateCode', 'title', 'subject']);
    return this.messageModel.findAndCountAll({
      where: where as never,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
  }

  /**
   * Mensajes a medio entregar que nadie va a retomar (A-03). `sending` entra junto a `pending`: lo deja
   * `markMessageSending` si el proceso muere entre marcar y entregar. El corte por antigüedad evita
   * competir con una entrega en vuelo; los avisos de campaña y los programados a futuro no son suyos.
   * El job de pendientes (sin corte) pide sólo `pending`: un `sending` reciente va en vuelo.
   */
  listStuckMessages(input: {
    tenantId: string;
    olderThanMinutes: number;
    limit: number;
    statuses?: readonly string[];
  }): Promise<NotificationMessageModel[]> {
    const cutoff = new Date(Date.now() - input.olderThanMinutes * 60_000);
    return this.messageModel.findAll({
      where: {
        tenantId: input.tenantId,
        status: { [Op.in]: input.statuses ?? ['pending', 'sending'] },
        createdAtValue: { [Op.lt]: cutoff },
        ...ownedByGenericJobs(),
      } as never,
      order: [['createdAtValue', 'ASC']],
      limit: input.limit,
    });
  }

  /**
   * Reabre para reintentar sólo un mensaje fallido (compare-and-set): un entregado o cancelado no se reenvía.
   */
  async markMessageRetrying(message: NotificationMessageModel): Promise<boolean> {
    const [reopened] = await this.messageModel.update({ status: 'retrying', failedAt: null, updatedAtValue: new Date() } as never, {
      where: { id: message.id, tenantId: message.tenantId, status: { [Op.in]: ['failed', 'retrying'] } } as never,
    });
    return reopened === 1;
  }

  /**
   * Reclama el mensaje para entregarlo (compare-and-set sobre el estado leído): si otra tanda (pendientes,
   * varados, reintento manual) llegó antes, el UPDATE no toca filas y quien llega segundo no envía.
   */
  async markMessageSending(message: NotificationMessageModel): Promise<boolean> {
    const now = new Date();
    const queuedAt = message.queuedAt ?? now;
    const [claimed] = await this.messageModel.update({ status: 'sending', queuedAt, updatedAtValue: now } as never, {
      where: { id: message.id, status: message.status } as never,
    });
    if (claimed !== 1) return false;
    message.status = 'sending';
    message.queuedAt = queuedAt;
    message.updatedAtValue = now;
    return true;
  }

  async cancelMessage(tenantId: string, messageId: string): Promise<NotificationMessageModel> {
    const message = await this.getMessage(tenantId, messageId);
    if (['sent', 'delivered', 'read'].includes(message.status)) throw new BadRequestException('SENT_MESSAGE_CANNOT_BE_CANCELLED');
    const now = new Date();
    message.status = 'cancelled';
    message.cancelledAt = now;
    message.updatedAtValue = now;
    await message.save();
    return message;
  }
}
