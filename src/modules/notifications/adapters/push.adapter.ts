import { Injectable } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { env } from '../../../config/env.js';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getAllDeliveryTargets, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

async function getGoogleAccessToken(input: { clientEmail: string; privateKey: string; executor: ResilientAdapterExecutorService }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(
    JSON.stringify({
      iss: input.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(normalizePrivateKey(input.privateKey)));
  const assertion = `${unsigned}.${signature}`;
  const response = await postJson(
    input.executor,
    'fcm_token',
    'https://oauth2.googleapis.com/token',
    {},
    { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
  );
  if (!response.ok || typeof response.json.access_token !== 'string') {
    throw new Error(`FCM_TOKEN_FAILED_HTTP_${response.status}`);
  }
  return response.json.access_token;
}

@Injectable()
export class PushNotificationAdapter implements NotificationChannelAdapter {
  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly executor: ResilientAdapterExecutorService,
  ) {}

  getProviderName(): string {
    return this.config.getPushProvider();
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'push';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'push' && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const provider = this.config.getPushProvider();
    if (provider === 'disabled') return failedDelivery('disabled_push', 'PUSH_PROVIDER_DISABLED', 'No hay proveedor push configurado.');
    if (provider === 'webhook') return this.sendWebhook(message);
    if (provider !== 'fcm') return failedDelivery(provider, 'UNSUPPORTED_PUSH_PROVIDER', `Proveedor push no soportado: ${provider}`);
    const tokens = getAllDeliveryTargets(message, 'fcm_token');
    if (tokens.length === 0) return failedDelivery('fcm', 'MISSING_FCM_TOKENS', 'No hay tokens FCM activos para el destinatario.');
    const projectId = this.config.require(env.FCM_PROJECT_ID, 'FCM_PROJECT_ID_MISSING');
    const clientEmail = this.config.require(env.FCM_CLIENT_EMAIL, 'FCM_CLIENT_EMAIL_MISSING');
    const privateKey = this.config.require(env.FCM_PRIVATE_KEY, 'FCM_PRIVATE_KEY_MISSING');
    const accessToken = await getGoogleAccessToken({ clientEmail, privateKey, executor: this.executor });
    const responses: Record<string, unknown>[] = [];
    let firstMessageId: string | null = null;
    for (const token of tokens) {
      const data: Record<string, string> = {
        notificationMessageId: message.id,
        channel: 'push',
        ...(message.correlationId ? { correlationId: message.correlationId } : {}),
      };
      const fcmMessage: Record<string, unknown> = { token, data };
      if (env.NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION) {
        fcmMessage.notification = { title: message.title ?? 'ATLAS', body: message.body };
      }
      const response = await postJson(
        this.executor,
        'fcm',
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        { authorization: `Bearer ${accessToken}` },
        {
          message: fcmMessage,
        },
      );
      responses.push({ ok: response.ok, status: response.status, body: response.json });
      if (!response.ok) return failedDelivery('fcm', 'FCM_SEND_FAILED', `FCM respondió HTTP ${response.status}.`, { responses });
      if (!firstMessageId && typeof response.json.name === 'string') firstMessageId = response.json.name;
    }
    return sentDelivery('fcm', firstMessageId ?? message.id, { count: tokens.length, responses });
  }

  private async sendWebhook(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const url = this.config.getWebhookUrl('push');
    if (!url) return failedDelivery('webhook_push', 'WEBHOOK_URL_MISSING', 'NOTIFICATION_WEBHOOK_URL no está configurado.');
    const response = await postJson(
      this.executor,
      'webhook_push',
      url,
      {},
      {
        channel: 'push',
        title: message.title,
        body: message.body,
        payload: message.payload,
        messageId: message.id,
        targets: message.deliveryTargets,
      },
    );
    if (!response.ok)
      return failedDelivery('webhook_push', 'WEBHOOK_PUSH_FAILED', `Webhook respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('webhook_push', String(response.json.id ?? response.json.messageId ?? message.id), response.json);
  }
}
