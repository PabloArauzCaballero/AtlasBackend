/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getFirstDeliveryTarget, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';
import { GmailApiAdapter } from './gmail/gmail.adapter.js';

@Injectable()
export class EmailNotificationAdapter implements NotificationChannelAdapter {
  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly executor: ResilientAdapterExecutorService,
    private readonly gmail: GmailApiAdapter,
  ) {}

  getProviderName(): string {
    return this.config.getEmailProvider();
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'email';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'email' && Boolean(message.subject) && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const provider = this.config.getEmailProvider();
    if (provider === 'disabled')
      return failedDelivery('disabled_email', 'EMAIL_PROVIDER_DISABLED', 'No hay proveedor de email configurado.');
    const to = getFirstDeliveryTarget(message, 'email');
    if (!to) return failedDelivery(provider, 'MISSING_EMAIL_RECIPIENT', 'El payload no contiene email, toEmail ni recipientEmail.');
    if (provider === 'resend') return this.sendResend(message, to);
    if (provider === 'sendgrid') return this.sendSendGrid(message, to);
    // Gmail vive en su propio adaptador: necesita canje OAuth con cache y construcción MIME
    // completa, no una llamada HTTP con API key como Resend/SendGrid.
    if (provider === 'gmail_api') return this.gmail.send(message);
    if (provider === 'webhook') return this.sendWebhook(message, to, 'email');
    return failedDelivery(provider, 'UNSUPPORTED_EMAIL_PROVIDER', `Proveedor email no soportado: ${provider}`);
  }

  private async sendWebhook(message: NotificationMessagePayload, to: string, channel: string): Promise<DeliveryResult> {
    const url = this.config.getWebhookUrl();
    if (!url) return failedDelivery('webhook_email', 'WEBHOOK_URL_MISSING', 'NOTIFICATION_WEBHOOK_URL no está configurado.');
    const response = await postJson(
      this.executor,
      'webhook_email',
      url,
      {},
      { channel, to, subject: message.subject, title: message.title, body: message.body, payload: message.payload, messageId: message.id },
    );
    if (!response.ok)
      return failedDelivery('webhook_email', 'WEBHOOK_EMAIL_FAILED', `Webhook respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('webhook_email', String(response.json.id ?? response.json.messageId ?? message.id), response.json);
  }

  private async sendResend(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const apiKey = this.config.require(env.RESEND_API_KEY, 'RESEND_API_KEY_MISSING');
    const from = this.config.require(env.RESEND_FROM_EMAIL, 'RESEND_FROM_EMAIL_MISSING');
    const response = await postJson(
      this.executor,
      'resend',
      'https://api.resend.com/emails',
      { authorization: `Bearer ${apiKey}` },
      { from, to: [to], subject: message.subject ?? 'ATLAS', text: message.body },
    );
    if (!response.ok) return failedDelivery('resend', 'RESEND_SEND_FAILED', `Resend respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('resend', typeof response.json.id === 'string' ? response.json.id : null, response.json);
  }

  private async sendSendGrid(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const apiKey = this.config.require(env.SENDGRID_API_KEY, 'SENDGRID_API_KEY_MISSING');
    const from = this.config.require(env.SENDGRID_FROM_EMAIL, 'SENDGRID_FROM_EMAIL_MISSING');
    const response = await postJson(
      this.executor,
      'sendgrid',
      'https://api.sendgrid.com/v3/mail/send',
      { authorization: `Bearer ${apiKey}` },
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject: message.subject ?? 'ATLAS',
        content: [{ type: 'text/plain', value: message.body }],
      },
    );
    if (!response.ok)
      return failedDelivery('sendgrid', 'SENDGRID_SEND_FAILED', `SendGrid respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('sendgrid', String(response.json.id ?? message.id), response.json);
  }
}
