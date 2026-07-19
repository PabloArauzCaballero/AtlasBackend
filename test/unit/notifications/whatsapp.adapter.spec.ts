import { describe, expect, it, jest } from '@jest/globals';
import { WhatsAppNotificationAdapter } from '../../../src/modules/notifications/adapters/whatsapp.adapter.js';

/**
 * `WhatsAppNotificationAdapter.send`: ramas de guarda (disabled / sin destinatario / proveedor no
 * soportado) y el camino Meta Cloud (éxito y fallo). Executor mockeado: resolver = HTTP ok, rechazar
 * = HTTP fallo.
 */
describe('WhatsAppNotificationAdapter', () => {
  function build(provider: string) {
    const config = { getWhatsAppProvider: () => provider, require: () => 'val', getWebhookUrl: () => null };
    const executor = { run: jest.fn() };
    return { adapter: new WhatsAppNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { phone: '+591700' }) => ({ id: '1', channel: 'whatsapp', body: 'hola', payload }) as never;

  it('supports y validatePayload', () => {
    const { adapter } = build('meta_cloud');
    expect(adapter.supports('whatsapp')).toBe(true);
    expect(adapter.validatePayload({ channel: 'whatsapp', body: 'hola' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'whatsapp', body: '' } as never)).toBe(false);
  });

  it('ramas de guarda: disabled / sin destinatario / proveedor no soportado', async () => {
    expect(await build('disabled').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WHATSAPP_PROVIDER_DISABLED' });
    expect(await build('meta_cloud').adapter.send(msg({}))).toMatchObject({ status: 'failed', errorCode: 'MISSING_WHATSAPP_RECIPIENT' });
    expect(await build('gupshup').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_WHATSAPP_PROVIDER' });
  });

  it('meta_cloud: éxito devuelve sent; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('meta_cloud');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { messages: [{ id: 'wam1' }] } } as never);
    expect((await ok.adapter.send(msg())).status).toBe('sent');

    const bad = build('meta_cloud');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect((await bad.adapter.send(msg())).status).toBe('failed');
  });
});
