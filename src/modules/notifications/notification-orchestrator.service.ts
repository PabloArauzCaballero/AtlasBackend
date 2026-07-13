import { Injectable } from '@nestjs/common';
import { OutboxEventModel } from '../../database/models/index.js';
import { NotificationChannelAdapter } from './adapters/notification-channel-adapter.js';
import { InAppNotificationAdapter } from './adapters/in-app-notification.adapter.js';
import { EmailNotificationAdapter } from './adapters/email.adapter.js';
import { PushNotificationAdapter } from './adapters/push.adapter.js';
import { SmsNotificationAdapter } from './adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from './adapters/whatsapp.adapter.js';
import { NotificationRulesService } from './notification-rules.service.js';
import { NotificationTemplateRendererService } from './notification-template-renderer.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationChannel, NotificationMessagePayload, RecipientType } from './notification-types.js';

function getPayloadValue(payload: Record<string, unknown>, path: string[] | undefined): string | null {
  if (!path || path.length === 0) return null;
  let current: unknown = payload;
  for (const part of path) {
    if (typeof current !== 'object' || current === null || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string' && current.trim().length > 0) return current;
  return null;
}

function defaultRecipientId(event: OutboxEventModel, recipientType: RecipientType, payload: Record<string, unknown>): string | null {
  if (recipientType === 'operations') return getPayloadValue(payload, ['assignedTeamId']) ?? 'operations';
  if (recipientType === 'customer' && event.aggregateType === 'customer' && event.aggregateId) return event.aggregateId;
  if (recipientType === 'merchant' && event.aggregateType === 'merchant' && event.aggregateId) return event.aggregateId;
  return null;
}

function fallbackText(eventCode: string, channel: NotificationChannel): { title: string; subject: string | null; body: string } {
  const readable = eventCode.replaceAll('.', ' ');
  return {
    title: `ATLAS: ${readable}`,
    subject: channel === 'email' ? `ATLAS: ${readable}` : null,
    body: `Se registró el evento ${eventCode}.`,
  };
}

@Injectable()
export class NotificationOrchestratorService {
  constructor(
    private readonly rulesService: NotificationRulesService,
    private readonly repository: NotificationsRepository,
    private readonly renderer: NotificationTemplateRendererService,
    private readonly inAppAdapter: InAppNotificationAdapter,
    private readonly emailAdapter: EmailNotificationAdapter,
    private readonly pushAdapter: PushNotificationAdapter,
    private readonly smsAdapter: SmsNotificationAdapter,
    private readonly whatsappAdapter: WhatsAppNotificationAdapter,
  ) {}

  private get adapters(): NotificationChannelAdapter[] {
    return [this.inAppAdapter, this.emailAdapter, this.pushAdapter, this.smsAdapter, this.whatsappAdapter];
  }

  async handleEvent(event: OutboxEventModel): Promise<void> {
    const payload = (event.eventPayloadJson ?? {}) as Record<string, unknown>;
    const rules = await Promise.resolve(this.rulesService.getRulesForEvent(event.eventCode));
    const rulesToApply = Array.isArray(rules) ? rules : [];
    for (const rule of rulesToApply) {
      const recipientId = getPayloadValue(payload, rule.recipientIdPath) ?? defaultRecipientId(event, rule.recipientType, payload);
      if (!recipientId) continue;
      for (const channel of rule.channels) {
        if (rule.recipientType === 'customer') {
          const enabled = await this.repository.isChannelEnabled({
            tenantId: String(event.tenantId),
            customerId: recipientId,
            eventCode: event.eventCode,
            channel,
            required: rule.required,
          });
          if (!enabled) continue;
        }

        const templateCode = `${rule.templatePrefix ?? event.eventCode.replaceAll('.', '_')}_${channel}`;
        const template = await this.repository.findTemplate({
          tenantId: event.tenantId === null ? null : String(event.tenantId),
          code: templateCode,
          channel,
        });
        const fallback = fallbackText(event.eventCode, channel);
        const title = this.renderer.render(template?.titleTemplate, payload, fallback.title);
        const subject =
          channel === 'email' ? this.renderer.render(template?.subjectTemplate, payload, fallback.subject ?? fallback.title) : null;
        const body = this.renderer.render(template?.bodyTemplate, payload, fallback.body);
        const idempotencyKey = `${event.idempotencyKey ?? event.eventCode}-${event.id}-${recipientId}-${channel}`;
        const message = await this.repository.createMessage({
          tenantId: event.tenantId === null ? null : String(event.tenantId),
          outboxEventId: String(event.id),
          recipientType: rule.recipientType,
          recipientId,
          channel,
          templateCode,
          subject,
          title,
          body,
          payload,
          priority: event.priority ?? 0,
          category: template?.category ?? null,
          icon: template?.icon ?? null,
          idempotencyKey,
          correlationId: event.correlationId,
          causationId: String(event.id),
        });
        await this.deliverMessage(message.id === undefined ? String(message.getDataValue('id')) : String(message.id));
      }
    }
  }

  async deliverMessage(messageId: string): Promise<void> {
    const message = await this.repository.getMessageForDelivery(messageId);
    if (['sent', 'delivered', 'read', 'cancelled'].includes(message.status)) return;
    const channel = message.channel as NotificationChannel;
    const adapter = this.adapters.find((candidate) => candidate.supports(channel));
    if (!adapter) throw new Error(`NO_ADAPTER_FOR_CHANNEL_${channel}`);

    const tenantId = message.tenantId === null ? null : String(message.tenantId);
    const fcmTokens =
      channel === 'push' && message.recipientType === 'customer'
        ? await this.repository.getActiveDeviceTokenSecrets(tenantId, message.recipientId)
        : [];
    const customerContactTargets =
      message.recipientType === 'customer' ? await this.repository.getCustomerContactTargets(tenantId, message.recipientId, channel) : [];
    const storedTargets = await this.repository.getMessageDeliveryTargets(message);
    const payload: NotificationMessagePayload = {
      id: String(message.id),
      tenantId,
      recipientType: message.recipientType,
      recipientId: message.recipientId,
      channel,
      subject: message.subject,
      title: message.title,
      body: message.body,
      payload: (message.payloadJson ?? {}) as Record<string, unknown>,
      correlationId: message.correlationId,
      deliveryTargets: [
        ...storedTargets,
        ...customerContactTargets,
        ...fcmTokens.map((token) => ({ kind: 'fcm_token' as const, address: token })),
      ],
    };
    if (!adapter.validatePayload(payload)) throw new Error(`INVALID_PAYLOAD_FOR_CHANNEL_${channel}`);
    await this.repository.markMessageSending(message);
    try {
      const result = await adapter.send(payload);
      await this.repository.recordDelivery(message, payload, result);
    } catch (error: unknown) {
      await this.repository.recordDelivery(message, payload, {
        status: 'failed',
        provider: adapter.getProviderName(),
        providerMessageId: null,
        response: null,
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'ADAPTER_SEND_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Fallo no identificado en adapter de notificación.',
      });
    }
  }
}
