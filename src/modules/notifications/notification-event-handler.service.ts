/**
 * @file Servicio de aplicación: convierte un evento de dominio en mensajes de notificación.
 * @business Entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system aplica reglas, preferencias y plantillas del evento, persiste el mensaje y lo entrega.
 */
import { Injectable } from '@nestjs/common';
import { OutboxEventModel } from '../../database/models/index.js';
import { defaultRecipientId, fallbackText, getPayloadValue, withoutDeliveryOverrides } from './notification-event-content.util.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import { NotificationMessagesRepository } from './notification-messages.repository.js';
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';
import { NotificationRulesService } from './notification-rules.service.js';
import { NotificationTemplateRendererService } from './notification-template-renderer.service.js';
import { NotificationTemplatesRepository } from './notification-templates.repository.js';

@Injectable()
export class NotificationEventHandlerService {
  constructor(
    private readonly rules: NotificationRulesService,
    private readonly preferences: NotificationPreferencesRepository,
    private readonly templates: NotificationTemplatesRepository,
    private readonly renderer: NotificationTemplateRendererService,
    private readonly messages: NotificationMessagesRepository,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async handleEvent(event: OutboxEventModel): Promise<void> {
    const payload = (event.eventPayloadJson ?? {}) as Record<string, unknown>;
    const rules = await Promise.resolve(this.rules.getRulesForEvent(event.eventCode));
    const rulesToApply = Array.isArray(rules) ? rules : [];
    for (const rule of rulesToApply) {
      const recipientId = getPayloadValue(payload, rule.recipientIdPath) ?? defaultRecipientId(event, rule.recipientType, payload);
      if (!recipientId) continue;
      for (const channel of rule.channels) {
        if (rule.recipientType === 'customer') {
          const enabled = await this.preferences.isChannelEnabled({
            tenantId: String(event.tenantId),
            customerId: recipientId,
            eventCode: event.eventCode,
            channel,
            required: rule.required,
          });
          if (!enabled) continue;
        }

        const templateCode = `${rule.templatePrefix ?? event.eventCode.replaceAll('.', '_')}_${channel}`;
        const template = await this.templates.findTemplate({
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
        const message = await this.messages.createMessage({
          tenantId: event.tenantId === null ? null : String(event.tenantId),
          outboxEventId: String(event.id),
          recipientType: rule.recipientType,
          recipientId,
          channel,
          templateCode,
          subject,
          title,
          body,
          payload: withoutDeliveryOverrides(payload),
          priority: event.priority ?? 0,
          category: template?.category ?? null,
          icon: template?.icon ?? null,
          idempotencyKey,
          correlationId: event.correlationId,
          causationId: String(event.id),
        });
        // Se pasa el modelo recién creado directamente para evitar una re-lectura innecesaria en
        // deliverMessage (getMessageForDelivery). El camino por-id sigue disponible para el outbox.
        await this.dispatch.deliverMessage(message);
      }
    }
  }
}
