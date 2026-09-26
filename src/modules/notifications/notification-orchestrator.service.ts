/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { TracingService } from '../../common/observability/tracing.service.js';
import { APP_ATTRIBUTES, SPAN_NAMES } from '../../observability/telemetry.constants.js';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationMessageModel, OutboxEventModel } from '../../database/models/index.js';
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

/** Resuelve el id de un mensaje de forma robusta: `.id` directo o `getDataValue('id')` como fallback. */
function resolveMessageId(message: NotificationMessageModel): string {
  if (message.id !== undefined && message.id !== null) return String(message.id);
  const viaDataValue = (message as { getDataValue?: (key: string) => unknown }).getDataValue?.('id');
  return String(viaDataValue);
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
  private readonly logger = new Logger(NotificationOrchestratorService.name);

  constructor(
    private readonly rulesService: NotificationRulesService,
    private readonly repository: NotificationsRepository,
    private readonly renderer: NotificationTemplateRendererService,
    private readonly inAppAdapter: InAppNotificationAdapter,
    private readonly emailAdapter: EmailNotificationAdapter,
    private readonly pushAdapter: PushNotificationAdapter,
    private readonly smsAdapter: SmsNotificationAdapter,
    private readonly whatsappAdapter: WhatsAppNotificationAdapter,
    @Optional() private readonly tracing: TracingService = new TracingService(),
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
        // Se pasa el modelo recién creado directamente para evitar una re-lectura innecesaria en
        // deliverMessage (getMessageForDelivery). El camino por-id sigue disponible para el outbox.
        await this.deliverMessage(message);
      }
    }
  }

  /**
   * `notification.dispatch` es un span de negocio de pleno derecho y no un tramo redundante: esta
   * entrega se invoca desde el despacho del outbox y desde las tandas de campaña, es decir DENTRO
   * de operaciones mayores y nunca 1:1 con una petición HTTP. Sin él, una campaña aparece en la
   * traza como un único bloque opaco y no se puede ver qué canal se atascó.
   *
   * Lo que se publica es el CANAL y el PROVEEDOR —dos catálogos cerrados— y el desenlace. Nunca el
   * destinatario, el asunto ni el cuerpo: son, literalmente, el mensaje que se envía a una persona.
   */
  async deliverMessage(messageOrId: string | NotificationMessageModel): Promise<void> {
    return this.tracing.runInSpan(
      SPAN_NAMES.notificationDispatch,
      { [APP_ATTRIBUTES.module]: 'notifications', [APP_ATTRIBUTES.operation]: 'dispatch' },
      () => this.dispatchMessage(messageOrId),
    );
  }

  private async dispatchMessage(messageOrId: string | NotificationMessageModel): Promise<void> {
    const message = typeof messageOrId === 'string' ? await this.repository.getMessageForDelivery(messageOrId) : messageOrId;
    if (['sent', 'delivered', 'read', 'cancelled'].includes(message.status)) return;
    const channel = message.channel as NotificationChannel;
    const adapter = this.adapters.find((candidate) => candidate.supports(channel));
    if (!adapter) throw new Error(`NO_ADAPTER_FOR_CHANNEL_${channel}`);

    // Resolución defensiva del id: algunos modelos Sequelize no exponen `.id` directamente y hay que
    // leerlo con getDataValue('id'). Se conserva esta robustez ahora que el modelo se pasa directo.
    const messageId = resolveMessageId(message);
    const tenantId = message.tenantId === null ? null : String(message.tenantId);
    const pushDevices =
      channel === 'push' && message.recipientType === 'customer'
        ? await this.repository.getActivePushDevices(tenantId, message.recipientId)
        : [];
    const customerContactTargets =
      message.recipientType === 'customer' ? await this.repository.getCustomerContactTargets(tenantId, message.recipientId, channel) : [];
    const storedTargets = await this.repository.getMessageDeliveryTargets(message);
    const payload: NotificationMessagePayload = {
      id: messageId,
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
        // La plataforma viaja en `metadata`: es lo que decide si el aviso sale por APNs o por FCM.
        ...pushDevices.map((device) => ({ kind: 'fcm_token' as const, address: device.token, metadata: { platform: device.platform } })),
      ],
    };
    if (!adapter.validatePayload(payload)) throw new Error(`INVALID_PAYLOAD_FOR_CHANNEL_${channel}`);
    this.tracing.setAttributes({ 'notification.channel': channel, 'notification.provider': adapter.getProviderName() });
    await this.repository.markMessageSending(message);
    try {
      const result = await adapter.send(payload);
      await this.repository.recordDelivery(message, payload, result);
      this.tracing.setAttribute('notification.outcome', result.status);
    } catch (error: unknown) {
      // El error se ABSORBE para no tumbar la tanda, pero el span sí queda marcado: una entrega
      // que falla en silencio es exactamente el fallo que nadie ve hasta que alguien reclama.
      this.tracing.setAttribute('notification.outcome', 'failed');
      this.tracing.recordException(error);
      // Antes el fallo de entrega solo quedaba como fila en notification_deliveries (status='failed'),
      // sin log ni métrica: para saber si las notificaciones estaban cayendo había que consultar la
      // tabla. Se registra con contexto (canal, proveedor) para que sea alertable.
      this.logger.warn(
        `Entrega FALLIDA del mensaje ${messageId} por ${channel}/${adapter.getProviderName()}: ` +
          `${error instanceof Error ? error.message : 'error desconocido'}`,
      );
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
