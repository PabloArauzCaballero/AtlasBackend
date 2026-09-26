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
import { readAddressList, readHtmlBody, readString } from './email-payload.util.js';
import { buildSendGridMail, readSendGridErrors, readSendGridMessageId } from './sendgrid/sendgrid-mail.util.js';
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

  /**
   * SendGrid —el correo de Twilio— por su API v3.
   *
   * El identificador del envío sale de la CABECERA `X-Message-Id`, no del cuerpo: un envío aceptado
   * responde `202` sin cuerpo. Antes se guardaba `message.id` (el interno de ATLAS) como
   * `provider_message_id`, y eso dejaba la columna llena de valores que ningún evento de SendGrid
   * menciona, así que ningún rebote se podía atribuir a su correo.
   */
  private async sendSendGrid(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const config = this.config.getSendGridConfig();
    if (!config.ok) return failedDelivery('sendgrid', config.missing, `Falta configuración de SendGrid: ${config.missing}.`);

    const response = await postJson(
      this.executor,
      'sendgrid',
      'https://api.sendgrid.com/v3/mail/send',
      { authorization: `Bearer ${config.value.apiKey}` },
      buildSendGridMail({
        to,
        cc: readAddressList(message.payload, 'cc'),
        bcc: readAddressList(message.payload, 'bcc'),
        from: config.value.fromEmail,
        fromName: config.value.fromName,
        replyTo: readString(message.payload, 'replyTo', 'reply_to') ?? config.value.replyToEmail,
        subject: message.subject ?? 'ATLAS',
        text: message.body,
        html: readHtmlBody(message.payload),
        atlasMessageId: message.id,
      }),
    );
    if (!response.ok) {
      const detalle = readSendGridErrors(response.json);
      return failedDelivery(
        'sendgrid',
        'SENDGRID_SEND_FAILED',
        `SendGrid respondió HTTP ${response.status}.${detalle ? ` ${detalle}` : ''}`,
        response.json,
      );
    }
    return sentDelivery('sendgrid', readSendGridMessageId(response.headers), response.json);
  }
}
