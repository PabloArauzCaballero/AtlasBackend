import { describe, expect, it, jest } from '@jest/globals';
import { generateKeyPairSync } from 'node:crypto';
import { PushNotificationAdapter } from '../../../src/modules/notifications/adapters/push.adapter.js';

/**
 * `PushNotificationAdapter.send`: ramas de guarda (disabled / proveedor no soportado / webhook sin url
 * / sin tokens FCM), el camino webhook (éxito y fallo) y el camino FCM completo (firma RS256 real con
 * una clave RSA generada en el test → token OAuth JWT-bearer → envío). Executor mockeado: resolver =
 * HTTP ok, rechazar = HTTP fallo (así lo traduce callResilient).
 */
describe('PushNotificationAdapter', () => {
  function build(provider: string, webhookUrl: string | null = null) {
    const config = { getPushProvider: () => provider, require: () => 'val', getWebhookUrl: () => webhookUrl };
    const executor = { run: jest.fn() };
    return { adapter: new PushNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { fcmToken: 'tok1' }) =>
    ({ id: '1', channel: 'push', title: 'T', body: 'b', payload, deliveryTargets: [] }) as never;

  it('supports y validatePayload', () => {
    const { adapter } = build('fcm');
    expect(adapter.supports('push')).toBe(true);
    expect(adapter.validatePayload({ channel: 'push', body: 'b' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'push', body: '' } as never)).toBe(false);
  });

  it('ramas de guarda: disabled / no soportado / webhook sin url / sin tokens FCM', async () => {
    expect(await build('disabled').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'PUSH_PROVIDER_DISABLED' });
    expect(await build('onesignal').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_PUSH_PROVIDER' });
    expect(await build('webhook', null).adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_URL_MISSING' });
    expect(await build('fcm').adapter.send(msg({}))).toMatchObject({ status: 'failed', errorCode: 'MISSING_FCM_TOKENS' });
  });

  it('webhook: éxito devuelve sent; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('webhook', 'https://hooks.example.com/push');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { id: 'w1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'webhook_push', providerMessageId: 'w1' });

    const bad = build('webhook', 'https://hooks.example.com/push');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_PUSH_FAILED' });
  });

  it('fcm: firma el JWT con la clave real, obtiene el token OAuth y envía (éxito); fallo del envío -> FCM_SEND_FAILED', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const buildFcm = () => {
      const config = {
        getPushProvider: () => 'fcm',
        require: (_v: unknown, code: string) => (code === 'FCM_PRIVATE_KEY_MISSING' ? privateKey : 'val'),
        getWebhookUrl: () => null,
      };
      const executor = { run: jest.fn() };
      return { adapter: new PushNotificationAdapter(config as never, executor as never), executor };
    };

    const ok = buildFcm();
    (ok.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockResolvedValueOnce({ status: 200, json: { name: 'projects/x/messages/1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'fcm', providerMessageId: 'projects/x/messages/1' });

    const bad = buildFcm();
    (bad.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockRejectedValueOnce(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'FCM_SEND_FAILED' });
  });

  it('fcm: token OAuth inválido (rechaza) propaga el fallo', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const config = {
      getPushProvider: () => 'fcm',
      require: (_v: unknown, code: string) => (code === 'FCM_PRIVATE_KEY_MISSING' ? privateKey : 'val'),
      getWebhookUrl: () => null,
    };
    const executor = { run: jest.fn() };
    (executor.run as jest.Mock).mockRejectedValueOnce(new Error('token boom') as never);
    const adapter = new PushNotificationAdapter(config as never, executor as never);
    await expect(adapter.send(msg())).rejects.toThrow(/FCM_TOKEN_FAILED/);
  });
});
