/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getFirstDeliveryTarget, postForm, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';
import { BREVO_API_BASE, brevoAuthHeader, brevoErrorDetails, brevoMessageId, toBrevoNumber } from './brevo/brevo-request.util.js';
import { brevoTemplateId, brevoTemplateParams } from './brevo/brevo-whatsapp.util.js';

function normalizeWhatsAppNumber(value: string): string {
  return value.replace(/^whatsapp:/, '');
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function templateParameters(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : []));
}

@Injectable()
export class WhatsAppNotificationAdapter implements NotificationChannelAdapter {
  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly executor: ResilientAdapterExecutorService,
  ) {}

  getProviderName(): string {
    return this.config.getWhatsAppProvider();
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'whatsapp';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'whatsapp' && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const provider = this.config.getWhatsAppProvider();
    if (provider === 'disabled')
      return failedDelivery('disabled_whatsapp', 'WHATSAPP_PROVIDER_DISABLED', 'No hay proveedor WhatsApp configurado.');
    const to = getFirstDeliveryTarget(message, 'whatsapp');
    if (!to)
      return failedDelivery(
        provider,
        'MISSING_WHATSAPP_RECIPIENT',
        'El payload no contiene whatsappTo, whatsapp, phone, toPhone ni recipientPhone.',
      );
    if (provider === 'webhook') return this.sendWebhook(message, to);
    if (provider === 'meta_cloud') return this.sendMetaCloud(message, to);
    if (provider === 'brevo') return this.sendBrevo(message, to);
    if (provider === 'twilio') return this.sendTwilio(message, to);
    return failedDelivery(provider, 'UNSUPPORTED_WHATSAPP_PROVIDER', `Proveedor WhatsApp no soportado: ${provider}`);
  }

  private async sendMetaCloud(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const token = this.config.require(env.META_WHATSAPP_TOKEN, 'META_WHATSAPP_TOKEN_MISSING');
    const phoneNumberId = this.config.require(env.META_WHATSAPP_PHONE_NUMBER_ID, 'META_WHATSAPP_PHONE_NUMBER_ID_MISSING');
    const templateName = stringPayload(message.payload.whatsappTemplateName) ?? env.META_WHATSAPP_DEFAULT_TEMPLATE_NAME;
    const templateLanguage = stringPayload(message.payload.whatsappTemplateLanguage) ?? env.META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE;
    const parameters = templateParameters(message.payload.whatsappTemplateParameters);
    const requestBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsAppNumber(to),
    };
    if (templateName && templateName.trim().length > 0) {
      requestBody.type = 'template';
      requestBody.template = {
        name: templateName,
        language: { code: templateLanguage },
        ...(parameters.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: parameters.map((text) => ({ type: 'text', text })),
                },
              ],
            }
          : {}),
      };
    } else {
      requestBody.type = 'text';
      requestBody.text = { preview_url: false, body: message.body };
    }
    const response = await postJson(
      this.executor,
      'meta_whatsapp_cloud',
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      { authorization: `Bearer ${token}` },
      requestBody,
    );
    if (!response.ok)
      return failedDelivery(
        'meta_whatsapp_cloud',
        'META_WHATSAPP_SEND_FAILED',
        `Meta WhatsApp respondió HTTP ${response.status}.`,
        response.json,
      );
    const messages = Array.isArray(response.json.messages) ? response.json.messages : [];
    const first = messages[0] as Record<string, unknown> | undefined;
    return sentDelivery('meta_whatsapp_cloud', typeof first?.id === 'string' ? first.id : null, response.json);
  }

  /**
   * Un WhatsApp por Brevo.
   *
   * SIEMPRE por plantilla, y no por comodidad: WhatsApp sólo deja escribir texto libre dentro de las
   * 24 h siguientes a que la persona escriba PRIMERO, y ATLAS no recibe WhatsApp entrante. Todo lo
   * que sale de aquí —el código de verificación, un aviso, una campaña— lo inicia la empresa, así
   * que Meta lo rechaza si no viene de una plantilla que ya aprobó. Un despliegue que mandara texto
   * libre «funcionaría» en las pruebas y fallaría en el primer cliente real.
   *
   * El texto del `message.body` viaja igual como respaldo: si un día hay conversación abierta —o
   * Brevo relaja la regla— el mensaje se entrega igual en vez de no salir.
   */
  private async sendBrevo(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const config = this.config.getBrevoWhatsAppConfig();
    if (!config.ok) return failedDelivery('brevo_whatsapp', config.missing, `Falta configuración de Brevo: ${config.missing}.`);
    const destino = toBrevoNumber(normalizeWhatsAppNumber(to), config.value.defaultCountryCode);
    if (!destino)
      return failedDelivery('brevo_whatsapp', 'INVALID_WHATSAPP_RECIPIENT', `El destinatario "${to}" no tiene forma de teléfono.`);
    const templateId = brevoTemplateId(message.payload.whatsappTemplateId) ?? config.value.defaultTemplateId;
    if (templateId === null)
      return failedDelivery(
        'brevo_whatsapp',
        'BREVO_WHATSAPP_TEMPLATE_MISSING',
        'Sin plantilla no hay WhatsApp iniciado por la empresa: configura BREVO_WHATSAPP_DEFAULT_TEMPLATE_ID o manda payload.whatsappTemplateId.',
      );

    const params = brevoTemplateParams(message.payload);
    const response = await postJson(
      this.executor,
      'brevo_whatsapp',
      `${BREVO_API_BASE}/whatsapp/sendMessage`,
      brevoAuthHeader(config.value.apiKey),
      {
        senderNumber: toBrevoNumber(config.value.senderNumber, config.value.defaultCountryCode) ?? config.value.senderNumber,
        contactNumbers: [destino],
        templateId,
        ...(Object.keys(params).length > 0 ? { params } : {}),
        ...(message.body ? { text: message.body } : {}),
      },
    );
    if (!response.ok) {
      const detalle = brevoErrorDetails(response.json);
      const sufijo = detalle.code ? ` (Brevo ${detalle.code}: ${detalle.message ?? 'sin detalle'})` : '';
      const codigo = detalle.permanent ? 'BREVO_WHATSAPP_RECIPIENT_REJECTED' : 'BREVO_WHATSAPP_SEND_FAILED';
      return failedDelivery('brevo_whatsapp', codigo, `Brevo respondió HTTP ${response.status}.${sufijo}`, response.json);
    }
    return sentDelivery('brevo_whatsapp', brevoMessageId(response.json.messageId), response.json);
  }

  private async sendTwilio(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const accountSid = this.config.require(env.TWILIO_ACCOUNT_SID, 'TWILIO_ACCOUNT_SID_MISSING');
    const authToken = this.config.require(env.TWILIO_AUTH_TOKEN, 'TWILIO_AUTH_TOKEN_MISSING');
    const from = this.config.require(env.TWILIO_WHATSAPP_FROM, 'TWILIO_WHATSAPP_FROM_MISSING');
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await postForm(
      this.executor,
      'twilio_whatsapp',
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      { authorization: `Basic ${credentials}` },
      {
        To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        Body: message.body,
      },
    );
    if (!response.ok)
      return failedDelivery('twilio_whatsapp', 'TWILIO_WHATSAPP_SEND_FAILED', `Twilio respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('twilio_whatsapp', typeof response.json.sid === 'string' ? response.json.sid : null, response.json);
  }

  private async sendWebhook(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const url = this.config.getWebhookUrl('whatsapp');
    if (!url) return failedDelivery('webhook_whatsapp', 'WEBHOOK_URL_MISSING', 'NOTIFICATION_WEBHOOK_URL no está configurado.');
    const response = await postJson(
      this.executor,
      'webhook_whatsapp',
      url,
      {},
      { channel: 'whatsapp', to, body: message.body, payload: message.payload, messageId: message.id },
    );
    if (!response.ok)
      return failedDelivery('webhook_whatsapp', 'WEBHOOK_WHATSAPP_FAILED', `Webhook respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('webhook_whatsapp', String(response.json.id ?? response.json.messageId ?? message.id), response.json);
  }
}
