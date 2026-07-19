import { describe, expect, it, jest } from '@jest/globals';
import { PushNotificationAdapter } from '../../../src/modules/notifications/adapters/push.adapter.js';

/**
 * `PushNotificationAdapter.send`: ramas de guarda (disabled / proveedor no soportado / webhook sin url
 * / sin tokens FCM) y el camino webhook (éxito y fallo). El camino FCM completo requiere firma RS256
 * con una clave real, fuera del alcance de este unit test. Executor mockeado.
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
});
