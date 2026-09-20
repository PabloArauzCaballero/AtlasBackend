/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { NotificationChannel } from '../notification-types.js';
import { twilioSender, type TwilioSender } from './twilio/twilio-request.util.js';

export type EmailProvider = 'disabled' | 'resend' | 'sendgrid' | 'gmail_api' | 'webhook';
export type PushProvider = 'disabled' | 'fcm' | 'webhook';
export type SmsProvider = 'disabled' | 'twilio' | 'webhook';
export type WhatsAppProvider = 'disabled' | 'meta_cloud' | 'twilio' | 'webhook';
export type PhoneProvider = 'disabled' | 'webhook';

export type GmailCredentials = { clientId: string; clientSecret: string; refreshToken: string; fromEmail: string };
/** Unión discriminada en vez de excepción: el adaptador de Gmail nunca lanza desde `send`. */
export type GmailCredentialsResult = { ok: true; value: GmailCredentials } | { ok: false; missing: string };

/** Credenciales de APNs: la llave `.p8` de App Store Connect, su identificador y el del equipo. */
export type ApnsCredentials = { keyId: string; teamId: string; privateKey: string; bundleId: string; production: boolean };
export type ApnsCredentialsResult = { ok: true; value: ApnsCredentials } | { ok: false; missing: string };

/** Lo que hace falta para poner un SMS en Twilio, ya resuelto: credenciales, remitente y callback. */
export type TwilioSmsConfig = {
  accountSid: string;
  authToken: string;
  sender: TwilioSender;
  statusCallbackUrl: string | null;
  defaultCountryCode: string;
};
export type TwilioSmsConfigResult = { ok: true; value: TwilioSmsConfig } | { ok: false; missing: string };

/** Lo que hace falta para poner un correo en SendGrid, ya resuelto: clave, remitente y respuestas. */
export type SendGridConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string | null;
  replyToEmail: string | null;
};
export type SendGridConfigResult = { ok: true; value: SendGridConfig } | { ok: false; missing: string };

/**
 * Nota de robustez: la validación fail-fast de "proveedor activo sin sus credenciales" para los
 * 5 canales de este servicio YA existe — vive en `src/config/env.ts` (`requireWhen`/
 * `requireWebhook` dentro del `.superRefine` de `envSchema`) y corre en `parseEnv()`, antes de
 * que Nest arranque cualquier módulo. Se evaluó agregar aquí un `OnModuleInit` equivalente
 * usando `src/common/resilience/provider-config-validator.ts` y se descartó a propósito: sería
 * exactamente la misma validación duplicada en dos lugares, corriendo la más tardía después de
 * la más temprana — sin ganancia real y con el costo de mantener las mismas reglas en dos
 * sitios. El validador fail-fast genérico del kernel de resiliencia se usa en `external-data`
 * (`ExternalProviderRegistryService`), que no tenía ningún equivalente.
 */
@Injectable()
export class NotificationProviderConfigService {
  getEmailProvider(): EmailProvider {
    return env.NOTIFICATION_EMAIL_PROVIDER;
  }

  getPushProvider(): PushProvider {
    return env.NOTIFICATION_PUSH_PROVIDER;
  }

  getSmsProvider(): SmsProvider {
    return env.NOTIFICATION_SMS_PROVIDER;
  }

  getWhatsAppProvider(): WhatsAppProvider {
    return env.NOTIFICATION_WHATSAPP_PROVIDER;
  }

  getPhoneProvider(): PhoneProvider {
    return env.NOTIFICATION_PHONE_PROVIDER;
  }

  /**
   * Credenciales de APNs, o qué falta.
   *
   * Va aquí y no leyendo `env` desde el adaptador por la misma razón que las de Gmail: `env` se
   * resuelve UNA vez al importar el módulo, así que un adaptador que lo lea directo no se puede
   * ejercitar con otra configuración sin recargar módulos.
   */
  getApnsCredentials(): ApnsCredentialsResult {
    const faltante = this.firstMissing({
      APNS_KEY_ID: env.APNS_KEY_ID,
      APNS_TEAM_ID: env.APNS_TEAM_ID,
      APNS_PRIVATE_KEY: env.APNS_PRIVATE_KEY,
      APNS_BUNDLE_ID: env.APNS_BUNDLE_ID,
    });
    if (faltante) return { ok: false, missing: faltante };
    return {
      ok: true,
      value: {
        keyId: env.APNS_KEY_ID as string,
        teamId: env.APNS_TEAM_ID as string,
        privateKey: env.APNS_PRIVATE_KEY as string,
        bundleId: env.APNS_BUNDLE_ID as string,
        production: env.APNS_ENVIRONMENT === 'production',
      },
    };
  }

  private firstMissing(values: Record<string, string | undefined>): string | null {
    for (const [name, value] of Object.entries(values)) if (!value) return name;
    return null;
  }

  /**
   * Configuración de Twilio para SMS, o qué falta.
   *
   * Devuelve la primera variable ausente en vez de lanzar, por la misma razón que Gmail y APNs: el
   * adaptador nunca lanza desde `send`, contesta un `DeliveryResult` fallido con el código exacto.
   *
   * El remitente se resuelve AQUÍ (`twilioSender`) y no en el adaptador porque «número suelto o
   * Messaging Service» es una decisión de configuración, no de envío: el adaptador sólo necesita
   * saber qué campo mandar.
   */
  getTwilioSmsConfig(): TwilioSmsConfigResult {
    const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
    if (!accountSid) return { ok: false, missing: 'TWILIO_ACCOUNT_SID_MISSING' };
    const authToken = env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) return { ok: false, missing: 'TWILIO_AUTH_TOKEN_MISSING' };
    const sender = twilioSender(env.TWILIO_SMS_FROM, env.TWILIO_MESSAGING_SERVICE_SID);
    if (!sender) return { ok: false, missing: 'TWILIO_SMS_SENDER_MISSING' };
    return {
      ok: true,
      value: {
        accountSid,
        authToken,
        sender,
        statusCallbackUrl: env.TWILIO_STATUS_CALLBACK_URL?.trim() || null,
        defaultCountryCode: env.NOTIFICATION_DEFAULT_COUNTRY_CODE,
      },
    };
  }

  /** Configuración de SendGrid —el correo de Twilio— o qué falta. */
  getSendGridConfig(): SendGridConfigResult {
    const apiKey = env.SENDGRID_API_KEY?.trim();
    if (!apiKey) return { ok: false, missing: 'SENDGRID_API_KEY_MISSING' };
    const fromEmail = env.SENDGRID_FROM_EMAIL?.trim();
    if (!fromEmail) return { ok: false, missing: 'SENDGRID_FROM_EMAIL_MISSING' };
    return {
      ok: true,
      value: {
        apiKey,
        fromEmail,
        fromName: env.SENDGRID_FROM_NAME?.trim() || null,
        replyToEmail: env.SENDGRID_REPLY_TO_EMAIL?.trim() || null,
      },
    };
  }

  /** La llave pública con la que SendGrid firma sus eventos, o `null` si el webhook no está activo. */
  getSendGridEventPublicKey(): string | null {
    return env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY?.trim() || null;
  }

  /** El token de cuenta con el que Twilio firma sus callbacks, o `null` si no hay Twilio configurado. */
  getTwilioAuthToken(): string | null {
    return env.TWILIO_AUTH_TOKEN?.trim() || null;
  }

  /**
   * La URL de callback tal y como se registró en Twilio.
   *
   * Es la URL que se FIRMA, así que tiene que ser la configurada y no una reconstruida a partir de
   * la petición: detrás de un proxy que termina TLS, `req.protocol` dice `http` donde Twilio firmó
   * `https` y la verificación fallaría siempre sin que el log dijera por qué.
   */
  getTwilioStatusCallbackUrl(): string | null {
    return env.TWILIO_STATUS_CALLBACK_URL?.trim() || null;
  }

  getWebhookUrl(channel?: NotificationChannel): string | undefined {
    if (channel === 'email') return env.NOTIFICATION_EMAIL_WEBHOOK_URL ?? env.NOTIFICATION_WEBHOOK_URL;
    if (channel === 'push') return env.NOTIFICATION_PUSH_WEBHOOK_URL ?? env.NOTIFICATION_WEBHOOK_URL;
    if (channel === 'sms') return env.NOTIFICATION_SMS_WEBHOOK_URL ?? env.NOTIFICATION_WEBHOOK_URL;
    if (channel === 'whatsapp') return env.NOTIFICATION_WHATSAPP_WEBHOOK_URL ?? env.NOTIFICATION_WEBHOOK_URL;
    if (channel === 'phone') return env.NOTIFICATION_PHONE_WEBHOOK_URL ?? env.NOTIFICATION_WEBHOOK_URL;
    return env.NOTIFICATION_WEBHOOK_URL;
  }

  getConfiguredProviderName(channel: NotificationChannel): string {
    if (channel === 'email') return this.getEmailProvider();
    if (channel === 'push') return this.getPushProvider();
    if (channel === 'sms') return this.getSmsProvider();
    if (channel === 'whatsapp') return this.getWhatsAppProvider();
    if (channel === 'phone') return this.getPhoneProvider();
    if (channel === 'in_app') return 'atlas_in_app';
    return 'disabled';
  }

  /**
   * Único punto donde el adaptador de Gmail toca `env`. Mantenerlo aquí —y devolver el código de la
   * PRIMERA variable ausente en vez de lanzar— deja al adaptador libre de `env`, que es lo que
   * permite ejercitarlo en pruebas unitarias sin recargar el módulo de configuración.
   */
  getGmailCredentials(): GmailCredentialsResult {
    const present = (value: string | undefined): string | null => (value && value.trim().length > 0 ? value.trim() : null);
    const clientId = present(env.GMAIL_CLIENT_ID);
    const clientSecret = present(env.GMAIL_CLIENT_SECRET);
    const refreshToken = present(env.GMAIL_REFRESH_TOKEN);
    const fromEmail = present(env.GMAIL_FROM_EMAIL);
    if (!clientId) return { ok: false, missing: 'GMAIL_CLIENT_ID_MISSING' };
    if (!clientSecret) return { ok: false, missing: 'GMAIL_CLIENT_SECRET_MISSING' };
    if (!refreshToken) return { ok: false, missing: 'GMAIL_REFRESH_TOKEN_MISSING' };
    if (!fromEmail) return { ok: false, missing: 'GMAIL_FROM_EMAIL_MISSING' };
    return { ok: true, value: { clientId, clientSecret, refreshToken, fromEmail } };
  }

  require(value: string | undefined, code: string): string {
    if (!value || value.trim().length === 0) {
      throw new Error(code);
    }
    return value;
  }
}
