import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getFirstDeliveryTarget, postForm, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';

@Injectable()
export class SmsNotificationAdapter implements NotificationChannelAdapter {
  constructor(private readonly config: NotificationProviderConfigService) {}

  getProviderName(): string {
    return this.config.getSmsProvider();
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'sms';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'sms' && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const provider = this.config.getSmsProvider();
    if (provider === 'disabled') return failedDelivery('disabled_sms', 'SMS_PROVIDER_DISABLED', 'No hay proveedor SMS configurado.');
    const to = getFirstDeliveryTarget(message, 'phone');
    if (!to) return failedDelivery(provider, 'MISSING_SMS_RECIPIENT', 'El payload no contiene phone, toPhone, recipientPhone ni smsTo.');
    if (provider === 'webhook') return this.sendWebhook(message, to);
    if (provider !== 'twilio') return failedDelivery(provider, 'UNSUPPORTED_SMS_PROVIDER', `Proveedor SMS no soportado: ${provider}`);
    const accountSid = this.config.require(env.TWILIO_ACCOUNT_SID, 'TWILIO_ACCOUNT_SID_MISSING');
    const authToken = this.config.require(env.TWILIO_AUTH_TOKEN, 'TWILIO_AUTH_TOKEN_MISSING');
    const from = this.config.require(env.TWILIO_SMS_FROM, 'TWILIO_SMS_FROM_MISSING');
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await postForm(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      { authorization: `Basic ${credentials}` },
      { To: to, From: from, Body: message.body },
    );
    if (!response.ok)
      return failedDelivery('twilio_sms', 'TWILIO_SMS_SEND_FAILED', `Twilio respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('twilio_sms', typeof response.json.sid === 'string' ? response.json.sid : null, response.json);
  }

  private async sendWebhook(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const url = this.config.getWebhookUrl('sms');
    if (!url) return failedDelivery('webhook_sms', 'WEBHOOK_URL_MISSING', 'NOTIFICATION_WEBHOOK_URL no está configurado.');
    const response = await postJson(url, {}, { channel: 'sms', to, body: message.body, payload: message.payload, messageId: message.id });
    if (!response.ok)
      return failedDelivery('webhook_sms', 'WEBHOOK_SMS_FAILED', `Webhook respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('webhook_sms', String(response.json.id ?? response.json.messageId ?? message.id), response.json);
  }
}
