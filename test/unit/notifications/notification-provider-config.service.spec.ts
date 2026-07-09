import { describe, expect, it, jest } from '@jest/globals';

/**
 * ATLAS-P12c (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9): último
 * servicio de `notifications` — con este archivo, los 4 servicios del módulo quedan cubiertos.
 * El caso más importante es `getWebhookUrl`: cada canal tiene su propia URL de webhook opcional
 * que cae al webhook genérico si no está configurada — un fallback mal aplicado enviaría
 * notificaciones de un canal al endpoint equivocado.
 */
jest.mock('../../../src/config/env.js', () => ({
  env: {
    NOTIFICATION_EMAIL_PROVIDER: 'resend',
    NOTIFICATION_PUSH_PROVIDER: 'fcm',
    NOTIFICATION_SMS_PROVIDER: 'twilio',
    NOTIFICATION_WHATSAPP_PROVIDER: 'meta_cloud',
    NOTIFICATION_PHONE_PROVIDER: 'disabled',
    NOTIFICATION_WEBHOOK_URL: 'https://generic.example/webhook',
    NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://email.example/webhook',
    NOTIFICATION_PUSH_WEBHOOK_URL: undefined,
    NOTIFICATION_SMS_WEBHOOK_URL: undefined,
    NOTIFICATION_WHATSAPP_WEBHOOK_URL: undefined,
    NOTIFICATION_PHONE_WEBHOOK_URL: undefined,
  },
}));

describe('NotificationProviderConfigService', () => {
  async function buildService() {
    const { NotificationProviderConfigService } =
      await import('../../../src/modules/notifications/adapters/notification-provider-config.service.js');
    return new NotificationProviderConfigService();
  }

  it('reads each channel provider from its own dedicated env var', async () => {
    const service = await buildService();
    expect(service.getEmailProvider()).toBe('resend');
    expect(service.getPushProvider()).toBe('fcm');
    expect(service.getSmsProvider()).toBe('twilio');
    expect(service.getWhatsAppProvider()).toBe('meta_cloud');
    expect(service.getPhoneProvider()).toBe('disabled');
  });

  describe('getWebhookUrl — fallback al webhook genérico por canal', () => {
    it('uses the channel-specific URL when configured (email has one)', async () => {
      const service = await buildService();
      expect(service.getWebhookUrl('email')).toBe('https://email.example/webhook');
    });

    it('falls back to the generic webhook URL when the channel-specific one is not configured (push has none)', async () => {
      const service = await buildService();
      expect(service.getWebhookUrl('push')).toBe('https://generic.example/webhook');
    });

    it('falls back to the generic webhook URL for sms, whatsapp, and phone alike', async () => {
      const service = await buildService();
      expect(service.getWebhookUrl('sms')).toBe('https://generic.example/webhook');
      expect(service.getWebhookUrl('whatsapp')).toBe('https://generic.example/webhook');
      expect(service.getWebhookUrl('phone')).toBe('https://generic.example/webhook');
    });

    it('returns the generic webhook URL when no channel is given at all', async () => {
      const service = await buildService();
      expect(service.getWebhookUrl()).toBe('https://generic.example/webhook');
    });

    it('returns the generic webhook URL for an unrecognized channel value (falls through every specific branch)', async () => {
      const service = await buildService();
      expect(service.getWebhookUrl('in_app' as never)).toBe('https://generic.example/webhook');
    });
  });

  describe('getConfiguredProviderName', () => {
    it('delegates to the matching per-channel getter for email/push/sms/whatsapp/phone', async () => {
      const service = await buildService();
      expect(service.getConfiguredProviderName('email')).toBe('resend');
      expect(service.getConfiguredProviderName('push')).toBe('fcm');
      expect(service.getConfiguredProviderName('sms')).toBe('twilio');
      expect(service.getConfiguredProviderName('whatsapp')).toBe('meta_cloud');
      expect(service.getConfiguredProviderName('phone')).toBe('disabled');
    });

    it('returns the literal "atlas_in_app" for the in_app channel — it has no external provider', async () => {
      const service = await buildService();
      expect(service.getConfiguredProviderName('in_app')).toBe('atlas_in_app');
    });

    it('returns "disabled" for any channel value it does not recognize, never throws or returns undefined', async () => {
      const service = await buildService();
      expect(service.getConfiguredProviderName('unknown_channel' as never)).toBe('disabled');
    });
  });

  describe('require', () => {
    it('returns the value unchanged when it is present and non-blank', async () => {
      const service = await buildService();
      expect(service.require('actual-value', 'SOME_MISSING_CODE')).toBe('actual-value');
    });

    it('throws an Error with the given code as the message when the value is undefined', async () => {
      const service = await buildService();
      expect(() => service.require(undefined, 'FCM_SERVER_KEY_MISSING')).toThrow('FCM_SERVER_KEY_MISSING');
    });

    it('throws when the value is present but whitespace-only', async () => {
      const service = await buildService();
      expect(() => service.require('   ', 'BLANK_VALUE_CODE')).toThrow('BLANK_VALUE_CODE');
    });
  });
});
