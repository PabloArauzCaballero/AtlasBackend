import { describe, expect, it, jest } from '@jest/globals';

/**
 * Las credenciales se resuelven en el SERVICIO y no en el adaptador, por la misma razón que las de
 * Gmail: `env` se congela al importarse, así que un adaptador que lo leyera directo no se podría
 * ejercitar con otra configuración sin recargar módulos. Lo que se fija aquí es que la ausencia de
 * una variable devuelva su código exacto —el adaptador nunca lanza desde `send`— y que el remitente
 * ya llegue resuelto.
 */
jest.mock('../../../src/config/env.js', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: ' token ',
    TWILIO_SMS_FROM: '+15550001111',
    TWILIO_MESSAGING_SERVICE_SID: undefined,
    TWILIO_STATUS_CALLBACK_URL: 'https://api.atlas.test/hook',
    NOTIFICATION_DEFAULT_COUNTRY_CODE: '+591',
    SENDGRID_API_KEY: 'SG.clave',
    SENDGRID_FROM_EMAIL: 'no-reply@atlas.test',
    SENDGRID_FROM_NAME: 'ATLAS',
    SENDGRID_REPLY_TO_EMAIL: '',
    SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY: '  ',
  },
}));

describe('NotificationProviderConfigService — Twilio y SendGrid', () => {
  /** El mismo objeto `env` que ve el servicio: mutarlo es la única forma de variar la configuración. */
  async function mockedEnv(): Promise<Record<string, unknown>> {
    return ((await import('../../../src/config/env.js')) as unknown as { env: Record<string, unknown> }).env;
  }

  async function buildService() {
    const { NotificationProviderConfigService } =
      await import('../../../src/modules/notifications/adapters/notification-provider-config.service.js');
    return new NotificationProviderConfigService();
  }

  it('Twilio: devuelve credenciales recortadas y el remitente ya resuelto', async () => {
    const service = await buildService();
    expect(service.getTwilioSmsConfig()).toEqual({
      ok: true,
      value: {
        accountSid: 'AC123',
        authToken: 'token',
        sender: { From: '+15550001111' },
        statusCallbackUrl: 'https://api.atlas.test/hook',
        defaultCountryCode: '+591',
      },
    });
  });

  it('Twilio: el Messaging Service sustituye al número suelto', async () => {
    const env = await mockedEnv();
    const previo = env.TWILIO_MESSAGING_SERVICE_SID;
    env.TWILIO_MESSAGING_SERVICE_SID = 'MG999';
    try {
      const service = await buildService();
      const config = service.getTwilioSmsConfig();
      expect(config.ok && config.value.sender).toEqual({ MessagingServiceSid: 'MG999' });
    } finally {
      env.TWILIO_MESSAGING_SERVICE_SID = previo;
    }
  });

  it('Twilio: cada variable ausente devuelve SU código, no un fallo genérico', async () => {
    const env = await mockedEnv();
    const service = await buildService();
    const sin = async (clave: string) => {
      const previo = env[clave];
      env[clave] = undefined;
      try {
        return service.getTwilioSmsConfig();
      } finally {
        env[clave] = previo;
      }
    };
    expect(await sin('TWILIO_ACCOUNT_SID')).toEqual({ ok: false, missing: 'TWILIO_ACCOUNT_SID_MISSING' });
    expect(await sin('TWILIO_AUTH_TOKEN')).toEqual({ ok: false, missing: 'TWILIO_AUTH_TOKEN_MISSING' });
    expect(await sin('TWILIO_SMS_FROM')).toEqual({ ok: false, missing: 'TWILIO_SMS_SENDER_MISSING' });
  });

  it('SendGrid: el nombre y el reply-to son opcionales y vacío se lee como ausente', async () => {
    const service = await buildService();
    expect(service.getSendGridConfig()).toEqual({
      ok: true,
      value: { apiKey: 'SG.clave', fromEmail: 'no-reply@atlas.test', fromName: 'ATLAS', replyToEmail: null },
    });
  });

  it('SendGrid: sin clave o sin remitente dice cuál falta', async () => {
    const env = await mockedEnv();
    const service = await buildService();
    const previo = env.SENDGRID_API_KEY;
    env.SENDGRID_API_KEY = undefined;
    try {
      expect(service.getSendGridConfig()).toEqual({ ok: false, missing: 'SENDGRID_API_KEY_MISSING' });
    } finally {
      env.SENDGRID_API_KEY = previo;
    }
    env.SENDGRID_FROM_EMAIL = undefined;
    expect(service.getSendGridConfig()).toEqual({ ok: false, missing: 'SENDGRID_FROM_EMAIL_MISSING' });
    env.SENDGRID_FROM_EMAIL = 'no-reply@atlas.test';
  });

  /** Una llave en blanco es «webhook no configurado», no una llave: el endpoint queda cerrado. */
  it('SendGrid: una llave pública en blanco se lee como ausente', async () => {
    const env = await mockedEnv();
    const service = await buildService();
    expect(service.getSendGridEventPublicKey()).toBeNull();
    env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = 'llave';
    expect(service.getSendGridEventPublicKey()).toBe('llave');
  });
});
