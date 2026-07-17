import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { lastCharacters, sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { redactSensitiveObject, stableStringify } from '../../common/utils/privacy/redaction.util.js';
import {
  CustomerContactMethodModel,
  DeviceTokenModel,
  NotificationDeliveryModel,
  NotificationMessageModel,
  // Solo como TIPOS para las firmas públicas de los delegadores; el acceso real a estas tablas vive
  // en `NotificationTemplatesRepository` / `NotificationPreferencesRepository` (Fase 2.3).
  NotificationTemplateModel,
  UserNotificationPreferenceModel,
} from '../../database/models/index.js';
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';
import { NotificationTemplatesRepository } from './notification-templates.repository.js';
import {
  CreateTemplateDto,
  CustomerNotificationsQueryDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
  UpsertDeviceTokenDto,
} from './notifications.schemas.js';
import { DeliveryResult, DeliveryTarget, NotificationChannel, NotificationMessagePayload, RecipientType } from './notification-types.js';

type StoredDeliveryTarget = {
  kind: DeliveryTarget['kind'];
  addressEncrypted: string;
  addressHash: string;
  last4: string;
};

function payloadString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

// ATLAS-P10-010: envelope encryption (data key propia por valor) en vez de la clave maestra
// única de secret-box.util.ts — ver ATLAS-PEND-106/112. Ambas funciones pasaron a ser async
// porque encryptSecretEnvelope/decryptSecretEnvelope lo son (una data key real por KMS
// requeriría una llamada de red); decryptSecretEnvelope sigue reconociendo el formato legado
// `v1:...` para no romper direcciones/tokens cifrados antes de esta migración.
async function buildEncryptedDeliveryTargets(
  channel: NotificationChannel,
  payload: Record<string, unknown>,
): Promise<StoredDeliveryTarget[]> {
  const targetSpecs: Partial<Record<NotificationChannel, { kind: DeliveryTarget['kind']; keys: string[] }>> = {
    email: { kind: 'email', keys: ['email', 'toEmail', 'recipientEmail'] },
    sms: { kind: 'phone', keys: ['phone', 'toPhone', 'recipientPhone', 'smsTo'] },
    whatsapp: { kind: 'whatsapp', keys: ['whatsappTo', 'whatsapp', 'phone', 'toPhone', 'recipientPhone'] },
    push: { kind: 'fcm_token', keys: ['fcmToken', 'pushToken', 'deviceToken'] },
  };
  const spec = targetSpecs[channel];
  if (!spec) return [];
  const address = payloadString(payload, spec.keys);
  if (!address) return [];
  return [
    {
      kind: spec.kind,
      addressEncrypted: await encryptSecretEnvelope(address),
      addressHash: sha256Hex(address),
      last4: lastCharacters(address, 4),
    },
  ];
}

async function decryptDeliveryTargets(value: Array<Record<string, unknown>> | null): Promise<DeliveryTarget[]> {
  if (!value) return [];
  const resolved = await Promise.all(
    value.map(async (item) => {
      const kind = item.kind;
      const encrypted = item.addressEncrypted;
      if ((kind !== 'email' && kind !== 'phone' && kind !== 'fcm_token' && kind !== 'whatsapp') || typeof encrypted !== 'string') return [];
      // TS no conserva el narrowing de `kind` a través del `await` siguiente; se fija el tipo
      // explícitamente aquí, donde el guard de arriba ya lo garantiza en runtime.
      const narrowedKind: DeliveryTarget['kind'] = kind;
      const address = await decryptSecretEnvelope(encrypted);
      return address ? [{ kind: narrowedKind, address }] : [];
    }),
  );
  return resolved.flat();
}

function encryptedValueToString(value: string | Buffer | null): string | null {
  if (!value) return null;
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

function channelContactType(channel: NotificationChannel): { contactType: string; kind: DeliveryTarget['kind'] } | null {
  if (channel === 'email') return { contactType: 'email', kind: 'email' };
  if (channel === 'sms') return { contactType: 'phone', kind: 'phone' };
  if (channel === 'whatsapp') return { contactType: 'phone', kind: 'whatsapp' };
  return null;
}

function mergeDeliveryTargets(targets: DeliveryTarget[]): DeliveryTarget[] {
  const seen = new Set<string>();
  const merged: DeliveryTarget[] = [];
  for (const target of targets) {
    const key = `${target.kind}:${target.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  return merged;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(NotificationMessageModel) private readonly messageModel: typeof NotificationMessageModel,
    @InjectModel(NotificationDeliveryModel) private readonly deliveryModel: typeof NotificationDeliveryModel,
    @InjectModel(DeviceTokenModel) private readonly deviceTokenModel: typeof DeviceTokenModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    // Fase 2.3: plantillas y preferencias son agregados propios con acceso acotado a su tabla; la
    // fachada delega para conservar su API pública.
    private readonly templatesRepository: NotificationTemplatesRepository,
    private readonly preferencesRepository: NotificationPreferencesRepository,
  ) {}

  // --- Plantillas: delegado en `NotificationTemplatesRepository` (Fase 2.3) ---------------------
  findTemplate(input: {
    tenantId: string | null;
    code: string;
    channel: NotificationChannel;
    locale?: string;
  }): Promise<NotificationTemplateModel | null> {
    return this.templatesRepository.findTemplate(input);
  }

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
      const existing = await this.messageModel.findOne({ where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    const now = new Date();
    return this.messageModel.create({
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
      deliveryTargetsJson: (await buildEncryptedDeliveryTargets(input.channel, input.payload)) as unknown as Array<Record<string, unknown>>,
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
  }

  /**
   * Batch de `createMessage` para el caso de broadcast (uno-a-muchos): todos los mensajes son
   * `channel: 'in_app'` con el mismo título/cuerpo/prioridad/categoría, solo cambia el
   * destinatario. `in_app` no tiene delivery targets que cifrar (`buildEncryptedDeliveryTargets`
   * devuelve `[]` para ese canal), así que es seguro insertarlos todos con un solo `bulkCreate`
   * en vez de N `create()` secuenciales.
   */
  async createBroadcastMessages(
    recipients: Array<{ recipientType: RecipientType; recipientId: string }>,
    content: {
      tenantId: string | null;
      title: string;
      body: string;
      priority: number;
      category: string | null;
      icon: string | null;
      correlationId: string | null;
    },
  ): Promise<NotificationMessageModel[]> {
    if (recipients.length === 0) return [];
    const now = new Date();
    return this.messageModel.bulkCreate(
      recipients.map(
        (recipient) =>
          ({
            tenantId: content.tenantId,
            outboxEventId: null,
            recipientType: recipient.recipientType,
            recipientId: recipient.recipientId,
            channel: 'in_app',
            templateCode: null,
            subject: null,
            title: content.title,
            body: content.body,
            payloadJson: {},
            deliveryTargetsJson: [],
            status: 'pending',
            priority: content.priority,
            category: content.category,
            icon: content.icon,
            scheduledAt: now,
            queuedAt: null,
            sentAt: null,
            deliveredAt: null,
            readAt: null,
            failedAt: null,
            cancelledAt: null,
            idempotencyKey: null,
            correlationId: content.correlationId,
            causationId: null,
            createdAtValue: now,
            updatedAtValue: now,
          }) as Record<string, unknown>,
      ) as never[],
    );
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

  async getCustomerMessage(tenantId: string, customerId: string, messageId: string): Promise<NotificationMessageModel> {
    return this.getRecipientMessage(tenantId, 'customer', customerId, messageId, 'CUSTOMER_NOTIFICATION_NOT_FOUND');
  }

  /**
   * Generaliza `getCustomerMessage`/`listCustomerMessages`/`countUnreadCustomerMessages`/
   * `markAllCustomerRead` (que siguen existiendo tal cual, ahora como wrappers de estos métodos)
   * para que el mismo inbox in-app sirva tanto a `customer` como a `internal_user` — usado por
   * los endpoints de autoservicio `internal-users/me/notifications*`.
   */
  async getRecipientMessage(
    tenantId: string,
    recipientType: RecipientType,
    recipientId: string,
    messageId: string,
    notFoundCode = 'NOTIFICATION_NOT_FOUND',
  ): Promise<NotificationMessageModel> {
    const message = await this.messageModel.findOne({
      where: { tenantId, recipientType, recipientId, id: messageId },
    });
    if (!message) throw new NotFoundException(notFoundCode);
    return message;
  }

  async listMessages(tenantId: string, query: ListMessagesQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    if (query.recipientType) where.recipientType = query.recipientType;
    if (query.recipientId) where.recipientId = query.recipientId;
    if (query.correlationId) where.correlationId = query.correlationId;
    if (query.from || query.to) {
      where.createdAtValue = {
        ...(query.from ? { [Op.gte]: query.from } : {}),
        ...(query.to ? { [Op.lte]: query.to } : {}),
      };
    }
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

  async listCustomerMessages(tenantId: string, customerId: string, query: CustomerNotificationsQueryDto) {
    return this.listRecipientMessages(tenantId, 'customer', customerId, query);
  }

  async listRecipientMessages(tenantId: string, recipientType: RecipientType, recipientId: string, query: CustomerNotificationsQueryDto) {
    const where: Record<string, unknown> = { tenantId, recipientType, recipientId, channel: 'in_app' };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    if (query.from || query.to) {
      where.createdAtValue = {
        ...(query.from ? { [Op.gte]: query.from } : {}),
        ...(query.to ? { [Op.lte]: query.to } : {}),
      };
    }
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

  async countUnreadCustomerMessages(tenantId: string, customerId: string): Promise<number> {
    return this.countUnreadMessages(tenantId, 'customer', customerId);
  }

  async countUnreadMessages(tenantId: string, recipientType: RecipientType, recipientId: string): Promise<number> {
    return this.messageModel.count({
      where: {
        tenantId,
        recipientType,
        recipientId,
        channel: 'in_app',
        readAt: null,
        status: { [Op.notIn]: ['cancelled', 'failed'] },
      } as never,
    });
  }

  async markMessageSending(message: NotificationMessageModel): Promise<void> {
    const now = new Date();
    message.status = 'sending';
    message.queuedAt = message.queuedAt ?? now;
    message.updatedAtValue = now;
    await message.save();
  }

  async recordDelivery(
    message: NotificationMessageModel,
    payload: NotificationMessagePayload,
    result: DeliveryResult,
  ): Promise<NotificationDeliveryModel> {
    const now = new Date();
    const attemptNumber = (await this.deliveryModel.count({ where: { notificationMessageId: message.id } })) + 1;
    const delivery = await this.deliveryModel.create({
      tenantId: message.tenantId,
      notificationMessageId: message.id,
      channel: message.channel,
      provider: result.provider,
      providerMessageId: result.providerMessageId ?? null,
      status: result.status,
      attemptNumber,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      requestPayloadJson: redactSensitiveObject(payload) as Record<string, unknown>,
      responsePayloadJson: redactSensitiveObject(result.response ?? {}) as Record<string, unknown>,
      sentAt: result.status === 'sent' || result.status === 'delivered' ? now : null,
      deliveredAt: result.status === 'delivered' ? now : null,
      failedAt: result.status === 'failed' ? now : null,
      createdAtValue: now,
    });

    if (result.status === 'failed') {
      message.status = 'failed';
      message.failedAt = now;
    } else if (result.status === 'delivered') {
      message.status = 'delivered';
      message.sentAt = now;
      message.deliveredAt = now;
    } else if (result.status === 'sent') {
      message.status = 'sent';
      message.sentAt = now;
    }
    message.updatedAtValue = now;
    await message.save();
    return delivery;
  }

  async listDeliveries(tenantId: string, messageId: string): Promise<NotificationDeliveryModel[]> {
    return this.deliveryModel.findAll({ where: { tenantId, notificationMessageId: messageId }, order: [['attemptNumber', 'ASC']] });
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

  async markRead(message: NotificationMessageModel): Promise<NotificationMessageModel> {
    const now = new Date();
    message.status = 'read';
    message.readAt = now;
    message.updatedAtValue = now;
    await message.save();
    return message;
  }

  async markAllCustomerRead(tenantId: string, customerId: string): Promise<number> {
    return this.markAllRecipientRead(tenantId, 'customer', customerId);
  }

  async markAllRecipientRead(tenantId: string, recipientType: RecipientType, recipientId: string): Promise<number> {
    const [count] = await this.messageModel.update(
      { status: 'read', readAt: new Date(), updatedAtValue: new Date() },
      {
        where: { tenantId, recipientType, recipientId, channel: 'in_app', readAt: null } as never,
      },
    );
    return count;
  }

  listTemplates(tenantId: string, query: ListTemplatesQueryDto) {
    return this.templatesRepository.listTemplates(tenantId, query);
  }
  createTemplate(tenantId: string, body: CreateTemplateDto): Promise<NotificationTemplateModel> {
    return this.templatesRepository.createTemplate(tenantId, body);
  }
  updateTemplate(tenantId: string, templateId: string, body: UpdateTemplateDto): Promise<NotificationTemplateModel> {
    return this.templatesRepository.updateTemplate(tenantId, templateId, body);
  }

  // --- Preferencias: delegado en `NotificationPreferencesRepository` (Fase 2.3) -----------------
  getPreferences(tenantId: string, customerId: string): Promise<UserNotificationPreferenceModel[]> {
    return this.preferencesRepository.getPreferences(tenantId, customerId);
  }
  upsertPreferences(tenantId: string, customerId: string, body: UpdatePreferencesDto): Promise<UserNotificationPreferenceModel[]> {
    return this.preferencesRepository.upsertPreferences(tenantId, customerId, body);
  }
  isChannelEnabled(input: {
    tenantId: string;
    customerId: string;
    eventCode: string;
    channel: NotificationChannel;
    required?: boolean;
  }): Promise<boolean> {
    return this.preferencesRepository.isChannelEnabled(input);
  }

  async upsertDeviceToken(tenantId: string, customerId: string, body: UpsertDeviceTokenDto): Promise<DeviceTokenModel> {
    const tokenHash = sha256Hex(stableStringify({ token: body.token }));
    const now = new Date();
    const existing = await this.deviceTokenModel.findOne({ where: { tenantId, customerId, platform: body.platform, tokenHash } });
    if (existing) {
      existing.isActive = true;
      existing.lastSeenAt = now;
      existing.tokenEncrypted = await encryptSecretEnvelope(body.token);
      existing.tokenLast4 = lastCharacters(body.token, 4);
      existing.deviceId = body.deviceId ?? existing.deviceId;
      existing.updatedAtValue = now;
      await existing.save();
      return existing;
    }
    return this.deviceTokenModel.create({
      tenantId,
      customerId,
      platform: body.platform,
      tokenHash,
      tokenEncrypted: await encryptSecretEnvelope(body.token),
      tokenLast4: lastCharacters(body.token, 4),
      deviceId: body.deviceId ?? null,
      isActive: true,
      lastSeenAt: now,
      createdAtValue: now,
      updatedAtValue: now,
    });
  }

  getMessageDeliveryTargets(message: NotificationMessageModel): Promise<DeliveryTarget[]> {
    return decryptDeliveryTargets(message.deliveryTargetsJson);
  }

  async getCustomerContactTargets(tenantId: string | null, customerId: string, channel: NotificationChannel): Promise<DeliveryTarget[]> {
    if (!tenantId) return [];
    const spec = channelContactType(channel);
    if (!spec) return [];
    const rows = await this.contactMethodModel.findAll({
      where: {
        tenantId,
        customerId,
        contactType: spec.contactType,
        contactValueEncrypted: { [Op.ne]: null },
        deleted: { [Op.ne]: true },
      } as never,
      order: [
        ['isPrimary', 'DESC'],
        ['lastSeenAt', 'DESC'],
        ['id', 'ASC'],
      ],
    });
    const resolvedTargets = await Promise.all(
      rows.map(async (row) => {
        const encrypted = encryptedValueToString(row.contactValueEncrypted as string | Buffer | null);
        const address = await decryptSecretEnvelope(encrypted);
        return address ? [{ kind: spec.kind, address }] : [];
      }),
    );
    return mergeDeliveryTargets(resolvedTargets.flat());
  }

  async getActiveDeviceTokenSecrets(tenantId: string | null, customerId: string): Promise<string[]> {
    if (!tenantId) return [];
    const rows = await this.deviceTokenModel.findAll({ where: { tenantId, customerId, isActive: true } });
    const decrypted = await Promise.all(rows.map((row) => decryptSecretEnvelope(row.tokenEncrypted)));
    return Array.from(new Set(decrypted.filter((token): token is string => Boolean(token))));
  }

  async deactivateDeviceToken(tenantId: string, customerId: string, deviceTokenId: string): Promise<DeviceTokenModel> {
    const token = await this.deviceTokenModel.findOne({ where: { tenantId, customerId, id: deviceTokenId } });
    if (!token) throw new NotFoundException('DEVICE_TOKEN_NOT_FOUND');
    token.isActive = false;
    token.updatedAtValue = new Date();
    await token.save();
    return token;
  }
}
