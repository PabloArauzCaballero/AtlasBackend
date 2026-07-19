import { describe, expect, it, jest } from '@jest/globals';
import { WhatsAppNotificationAdapter } from '../../../src/modules/notifications/adapters/whatsapp.adapter.js';

/**
 * `WhatsAppNotificationAdapter.send`: ramas de guarda (disabled / sin destinatario / proveedor no
 * soportado) y los caminos Meta Cloud (texto y template con parámetros), Twilio y webhook (éxito y
 * fallo). Executor mockeado: resolver = HTTP ok, rechazar = HTTP fallo.
 */
describe('WhatsAppNotificationAdapter', () => {
  function build(provider: string, webhookUrl: string | null = null) {
    const config = { getWhatsAppProvider: () => provider, require: () => 'val', getWebhookUrl: () => webhookUrl };
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

  it('meta_cloud con template + parámetros usa la rama components y devuelve el id del mensaje', async () => {
    const ok = build('meta_cloud');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { messages: [{ id: 'wam2' }] } } as never);
    const res = await ok.adapter.send(
      msg({ phone: 'whatsapp:+591700', whatsappTemplateName: 'otp', whatsappTemplateLanguage: 'es', whatsappTemplateParameters: ['123', 456] }),
    );
    expect(res).toMatchObject({ status: 'sent', provider: 'meta_whatsapp_cloud', providerMessageId: 'wam2' });
  });

  it('twilio: éxito devuelve sent con el sid; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('twilio');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 201, json: { sid: 'SM1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'twilio_whatsapp', providerMessageId: 'SM1' });
    const bad = build('twilio');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'TWILIO_WHATSAPP_SEND_FAILED' });
  });

  it('webhook: sin url -> WEBHOOK_URL_MISSING; con url -> sent(webhook_whatsapp); fallo -> WEBHOOK_WHATSAPP_FAILED', async () => {
    expect(await build('webhook', null).adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_URL_MISSING' });
    const ok = build('webhook', 'https://hook.example');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { id: 'wh_1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'webhook_whatsapp', providerMessageId: 'wh_1' });
    const bad = build('webhook', 'https://hook.example');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_WHATSAPP_FAILED' });
  });
});
