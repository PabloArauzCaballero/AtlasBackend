/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { env } from '../../../config/env.js';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getAllDeliveryTargets, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';
import { base64Url } from '../../../common/utils/crypto/encoding.util.js';
import { APNS_TRANSPORT, ApnsTransport, sendApns } from './apns.util.js';
import { DEVICE_TOKEN_REGISTRY_PORT, type DeviceTokenRegistryPort } from '../application/ports/device-token-registry.port.js';
import { ANDROID_PUSH_CHANNEL, extraPushData, wantsVisiblePush } from './push-payload.util.js';

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

async function getGoogleAccessToken(input: {
  clientEmail: string;
  privateKey: string;
  executor: ResilientAdapterExecutorService;
}): Promise<string> {
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
    /**
     * Puerto del transporte HTTP/2 de APNs; las pruebas inyectan uno falso. Ver `apns.util.ts`.
     *
     * Necesita `@Optional()` y un TOKEN: un parámetro cuyo tipo es una función no es un proveedor, y
     * Nest intentaba resolverlo igual —`can't resolve dependencies ... argument at index [2]`— y
     * tumbaba el arranque del contenedor entero. Que sea opcional en TypeScript no basta.
     */
    @Optional() @Inject(APNS_TRANSPORT) private readonly apnsTransport?: ApnsTransport,
    /**
     * Puerto de baja de tokens muertos. Opcional por la MISMA razón que el transporte: es un Symbol
     * y no un proveedor deducible del tipo. Si no está, el envío sigue funcionando y sólo se pierde
     * la baja — nunca al revés.
     */
    @Optional() @Inject(DEVICE_TOKEN_REGISTRY_PORT) private readonly deviceTokens?: DeviceTokenRegistryPort,
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

    /*
      Los iPhone van por APNs, y no es una preferencia: un token de iOS lo emite Apple y FCM sólo
      acepta los suyos, así que mandarlo ahí lo rechaza SIEMPRE. Hasta que la plataforma viajó en
      `metadata` no había forma de separarlos, y los avisos a iPhone fallaban uno a uno sin que el
      motivo dijera nada de iOS.
    */
    const iosTokens = tokens.filter((token) => this.isIosToken(message, token));
    const fcmTokens = tokens.filter((token) => !iosTokens.includes(token));
    const ios = iosTokens.length > 0 ? await this.sendToApple(message, iosTokens) : null;
    if (fcmTokens.length === 0) return ios ?? failedDelivery('fcm', 'MISSING_FCM_TOKENS', 'No hay tokens activos.');
    if (ios && ios.status === 'failed') return ios;
    return this.sendToFirebase(message, fcmTokens, ios);
  }

  /** El camino de Android: OAuth con la cuenta de servicio y un envío por token. */
  private async sendToFirebase(
    message: NotificationMessagePayload,
    fcmTokens: string[],
    ios: DeliveryResult | null,
  ): Promise<DeliveryResult> {
    const projectId = this.config.require(env.FCM_PROJECT_ID, 'FCM_PROJECT_ID_MISSING');
    const clientEmail = this.config.require(env.FCM_CLIENT_EMAIL, 'FCM_CLIENT_EMAIL_MISSING');
    const privateKey = this.config.require(env.FCM_PRIVATE_KEY, 'FCM_PRIVATE_KEY_MISSING');
    const accessToken = await getGoogleAccessToken({ clientEmail, privateKey, executor: this.executor });
    const responses: Record<string, unknown>[] = [];
    let firstMessageId: string | null = null;
    for (const token of fcmTokens) {
      const data: Record<string, string> = {
        notificationMessageId: message.id,
        channel: 'push',
        ...(message.correlationId ? { correlationId: message.correlationId } : {}),
        ...extraPushData(message.payload),
      };
      const fcmMessage: Record<string, unknown> = { token, data };
      if (env.NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION || wantsVisiblePush(message.payload)) {
        fcmMessage.notification = { title: message.title ?? 'ATLAS', body: message.body };
      }
      if (wantsVisiblePush(message.payload)) fcmMessage.android = { notification: { channel_id: ANDROID_PUSH_CHANNEL } };
      const response = await postJson(
        this.executor,
        'fcm',
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        { authorization: `Bearer ${accessToken}` },
        { message: fcmMessage },
      );
      responses.push({ ok: response.ok, status: response.status, body: response.json });
      if (!response.ok) return failedDelivery('fcm', 'FCM_SEND_FAILED', `FCM respondió HTTP ${response.status}.`, { responses });
      if (!firstMessageId && typeof response.json.name === 'string') firstMessageId = response.json.name;
    }
    return sentDelivery('fcm', firstMessageId ?? message.id, {
      count: fcmTokens.length,
      responses,
      ...(ios ? { apns: ios.response } : {}),
    });
  }

  /** La plataforma la declara el dispositivo al registrarse y viaja en `metadata` del destinatario. */
  private isIosToken(message: NotificationMessagePayload, token: string): boolean {
    const target = (message.deliveryTargets ?? []).find((candidate) => candidate.kind === 'fcm_token' && candidate.address === token);
    return String(target?.metadata?.platform ?? '').toLowerCase() === 'ios';
  }

  /**
   * Entrega a los iPhone.
   *
   * Sin credenciales de Apple NO se cae al camino de FCM: ahí el token se rechazaría igual y el error
   * hablaría de Firebase. Se dice lo que pasa —falta configuración de APNs— para que se arregle donde
   * toca.
   */
  private async sendToApple(message: NotificationMessagePayload, tokens: string[]): Promise<DeliveryResult> {
    const credentials = this.config.getApnsCredentials();
    if (!credentials.ok) {
      return failedDelivery('apns', 'APNS_NOT_CONFIGURED', `Falta ${credentials.missing} para entregar a iPhone.`, {
        tokens: tokens.length,
      });
    }
    const result = await sendApns({
      credentials: credentials.value,
      tokens,
      title: message.title ?? 'ATLAS',
      body: message.body,
      data: {
        notificationMessageId: message.id,
        channel: 'push',
        ...(message.correlationId ? { correlationId: message.correlationId } : {}),
        ...extraPushData(message.payload),
      },
      visible: env.NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION || wantsVisiblePush(message.payload),
      transport: this.apnsTransport,
    });
    /*
      Un 410 no se cuenta como fallo: Apple dice que ese dispositivo desinstaló la app. Se da de baja
      por el puerto —dejar de intentarlo es lo que protege la reputación de envío— y el desenlace
      viaja en la respuesta con los últimos cuatro caracteres del token, nunca el token.
    */
    const response = {
      count: tokens.length,
      unregistered: result.unregistered.length,
      ...(await this.deactivate(result.unregistered)),
      responses: result.responses,
    };
    return result.ok
      ? sentDelivery('apns', message.id, response)
      : failedDelivery('apns', 'APNS_SEND_FAILED', 'APNs rechazó al menos un envío.', response);
  }

  /**
   * Da de baja los tokens que Apple declaró muertos, y dice qué pasó.
   *
   * Tres desenlaces distintos, y ninguno puede confundirse con otro:
   *  - `deactivated: n` — se apagaron n filas.
   *  - `deactivationUnavailable` — no hay puerto cableado (el worker de un piloto, una prueba).
   *  - `deactivationFailed` — la base falló.
   *
   * **La baja nunca tumba la entrega.** El aviso ya salió; que la base no conteste no lo deshace, y
   * convertir un envío correcto en `failed` por eso haría reintentar un mensaje ya entregado. Si
   * `unregistered` es mayor que cero y `deactivated` es cero, la huella dejó de coincidir con la del
   * registro: es la avería que `deviceTokenFingerprint` y su prueba existen para impedir.
   */
  private async deactivate(unregistered: string[]): Promise<Record<string, unknown>> {
    if (unregistered.length === 0) return { deactivated: 0 };
    if (!this.deviceTokens) return { deactivationUnavailable: true };
    try {
      return { deactivated: await this.deviceTokens.deactivate(unregistered) };
    } catch (error) {
      return { deactivationFailed: error instanceof Error ? error.message : 'error desconocido' };
    }
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
