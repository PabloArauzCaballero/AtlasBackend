import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { NotificationChannel } from '../notification-types.js';

export type EmailProvider = 'disabled' | 'resend' | 'sendgrid' | 'gmail_api' | 'webhook';
export type PushProvider = 'disabled' | 'fcm' | 'webhook';
export type SmsProvider = 'disabled' | 'twilio' | 'webhook';
export type WhatsAppProvider = 'disabled' | 'meta_cloud' | 'twilio' | 'webhook';
export type PhoneProvider = 'disabled' | 'webhook';

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

  require(value: string | undefined, code: string): string {
    if (!value || value.trim().length === 0) {
      throw new Error(code);
    }
    return value;
  }
}
