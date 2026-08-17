/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { ResilientAdapterExecutorService } from '../../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../../notification-types.js';
import { failedDelivery, getAllDeliveryTargets, postJson, sentDelivery } from '../http-adapter.util.js';
import { NotificationChannelAdapter } from '../notification-channel-adapter.js';
import { NotificationProviderConfigService } from '../notification-provider-config.service.js';
import { buildGmailRawMessage, isValidEmailAddress } from './gmail-mime.util.js';
import { GmailOAuthError, GmailOAuthTokenService } from './gmail-oauth-token.service.js';

export const GMAIL_PROVIDER = 'gmail_api';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly response: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'GmailAdapterError';
  }
}

export type GmailSendInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  boundarySeed: string;
};

export type GmailSendResult = {
  id: string | null;
  threadId: string | null;
  response: Record<string, unknown>;
};

function readString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** `cc`/`bcc` llegan del payload como string suelto o como lista; se normalizan a lista. */
function readAddressList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim());
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
  return [];
}

/**
 * Adaptador dedicado a la Gmail API (`users.messages.send`) con OAuth2 de refresh token.
 *
 * Existe aparte de `EmailNotificationAdapter` porque Gmail no es "otro proveedor HTTP con API key":
 * exige un canje OAuth previo con su propio ciclo de vida (cache, invalidación, reintento ante
 * 401), y exige construir el correo entero en MIME —no un JSON de campos— con las trampas de
 * cabecera que eso arrastra (acentos, inyección por salto de línea, multipart HTML). Meter todo eso
 * dentro del adaptador multi-proveedor lo convertía en el archivo más complejo del módulo y hacía
 * imposible probar el MIME sin pasar por el enrutado de proveedores.
 */
@Injectable()
export class GmailApiAdapter implements NotificationChannelAdapter {
  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly tokens: GmailOAuthTokenService,
    private readonly executor: ResilientAdapterExecutorService,
  ) {}

  getProviderName(): string {
    return GMAIL_PROVIDER;
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'email';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'email' && Boolean(message.subject) && Boolean(message.body);
  }

  /** ¿Están las 4 variables de entorno de Gmail presentes? Útil para health checks y arranque. */
  isConfigured(): boolean {
    return this.config.getGmailCredentials().ok;
  }

  /** ¿Gmail es además el proveedor ELEGIDO en `.env` y tiene credenciales? */
  isEnabled(): boolean {
    return this.config.getEmailProvider() === GMAIL_PROVIDER && this.isConfigured();
  }

  /**
   * Nunca lanza: cualquier fallo se traduce a un `DeliveryResult` fallido con código estable, que es
   * lo que el orquestador persiste en `notification_deliveries`.
   */
  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    try {
      this.assertSelectedInEnv();
      const recipients = getAllDeliveryTargets(message, 'email');
      if (recipients.length === 0) {
        return failedDelivery(GMAIL_PROVIDER, 'MISSING_EMAIL_RECIPIENT', 'El payload no contiene email, toEmail ni recipientEmail.');
      }
      const sent = await this.sendEmail({
        to: recipients,
        cc: readAddressList(message.payload, 'cc'),
        bcc: readAddressList(message.payload, 'bcc'),
        replyTo: readString(message.payload, 'replyTo', 'reply_to'),
        subject: message.subject ?? 'ATLAS',
        text: message.body,
        html: readString(message.payload, 'html', 'htmlBody'),
        boundarySeed: message.id,
      });
      return sentDelivery(GMAIL_PROVIDER, sent.id, sent.response);
    } catch (error) {
      if (error instanceof GmailAdapterError || error instanceof GmailOAuthError) {
        return failedDelivery(GMAIL_PROVIDER, error.code, error.message, error.response ?? undefined);
      }
      const detail = error instanceof Error ? error.message : 'error desconocido';
      return failedDelivery(GMAIL_PROVIDER, 'GMAIL_SEND_FAILED', `Fallo no clasificado al enviar por Gmail: ${detail}`);
    }
  }

  /**
   * API tipada del adaptador para envíos directos (HTML, copias, reply-to) sin pasar por el
   * orquestador de notificaciones. Lanza `GmailAdapterError`/`GmailOAuthError`.
   */
  async sendEmail(input: GmailSendInput): Promise<GmailSendResult> {
    this.assertSelectedInEnv();
    const credentials = this.readCredentials();
    const raw = buildGmailRawMessage({
      from: credentials.fromEmail,
      to: this.validateAddresses(input.to, 'destinatario'),
      cc: this.validateAddresses(input.cc ?? [], 'copia'),
      bcc: this.validateAddresses(input.bcc ?? [], 'copia oculta'),
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
      boundarySeed: input.boundarySeed,
    });

    const response = await this.postWithFreshTokenOn401(credentials, raw);
    if (!response.ok) {
      throw new GmailAdapterError('GMAIL_SEND_FAILED', `Gmail API respondió HTTP ${response.status} al enviar el mensaje.`, response.json);
    }
    return {
      id: typeof response.json.id === 'string' ? response.json.id : null,
      threadId: typeof response.json.threadId === 'string' ? response.json.threadId : null,
      response: response.json,
    };
  }

  /**
   * Un 401 aquí significa token revocado o expirado antes de tiempo, no una credencial mala: el
   * canje OAuth previo ya había respondido 200. Se descarta el token cacheado y se reintenta UNA
   * vez; un segundo 401 sí es un problema de configuración y se propaga.
   */
  private async postWithFreshTokenOn401(
    credentials: ReturnType<GmailApiAdapter['readCredentials']>,
    raw: string,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const first = await this.postSend(await this.tokens.getAccessToken(credentials), raw);
    if (first.status !== 401) return first;
    this.tokens.invalidate();
    return this.postSend(await this.tokens.getAccessToken(credentials), raw);
  }

  private async postSend(accessToken: string, raw: string) {
    return postJson(this.executor, GMAIL_PROVIDER, GMAIL_SEND_URL, { authorization: `Bearer ${accessToken}` }, { raw });
  }

  /**
   * `NOTIFICATION_EMAIL_PROVIDER` es lo que ELIGE el adaptador de correo activo, y esa decisión no
   * puede depender de por dónde se entre. `EmailNotificationAdapter` ya enruta por esa variable,
   * pero este adaptador está exportado por `NotificationsModule`: sin esta guarda, un módulo que lo
   * inyectara directamente enviaría por Gmail aunque el despliegue tuviera el canal en `disabled` o
   * apuntando a Resend/SendGrid — es decir, el `.env` diría una cosa y el sistema haría otra.
   */
  private assertSelectedInEnv(): void {
    const provider = this.config.getEmailProvider();
    if (provider !== GMAIL_PROVIDER) {
      throw new GmailAdapterError(
        'GMAIL_PROVIDER_NOT_SELECTED',
        `El proveedor de email activo es "${provider}"; Gmail solo envía con NOTIFICATION_EMAIL_PROVIDER=gmail_api.`,
      );
    }
  }

  private readCredentials(): { clientId: string; clientSecret: string; refreshToken: string; fromEmail: string } {
    const credentials = this.config.getGmailCredentials();
    if (!credentials.ok) {
      throw new GmailAdapterError(credentials.missing, `Falta la variable de entorno requerida para Gmail: ${credentials.missing}.`);
    }
    return credentials.value;
  }

  /**
   * Las direcciones se validan antes de armar el MIME. El mensaje de error lleva el conteo, nunca
   * las direcciones: en un backend KYC un correo es PII y este texto termina persistido en
   * `notification_deliveries`.
   */
  private validateAddresses(addresses: string[], role: string): string[] {
    const invalid = addresses.filter((address) => !isValidEmailAddress(address));
    if (invalid.length > 0) {
      throw new GmailAdapterError('GMAIL_INVALID_RECIPIENT', `${invalid.length} dirección(es) de ${role} con formato inválido.`);
    }
    return addresses;
  }
}
