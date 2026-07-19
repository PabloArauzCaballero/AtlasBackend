import { describe, expect, it, jest } from '@jest/globals';
import { EmailNotificationAdapter } from '../../../src/modules/notifications/adapters/email.adapter.js';

/**
 * `EmailNotificationAdapter.send`: ramas de guarda (disabled / sin destinatario / proveedor no
 * soportado / webhook sin url) y el camino Resend (éxito y fallo). Executor mockeado: resolver = HTTP
 * ok, rechazar = HTTP fallo.
 */
describe('EmailNotificationAdapter', () => {
  function build(provider: string, webhookUrl: string | null = null) {
    const config = { getEmailProvider: () => provider, require: () => 'val', getWebhookUrl: () => webhookUrl };
    const executor = { run: jest.fn() };
    return { adapter: new EmailNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { email: 'a@x.com' }) =>
    ({ id: '1', channel: 'email', subject: 'S', body: 'b', payload }) as never;

  it('supports y validatePayload (exige subject y body)', () => {
    const { adapter } = build('resend');
    expect(adapter.supports('email')).toBe(true);
    expect(adapter.validatePayload({ channel: 'email', subject: 'S', body: 'b' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'email', subject: '', body: 'b' } as never)).toBe(false);
  });

  it('ramas de guarda: disabled / sin destinatario / no soportado / webhook sin url', async () => {
    expect(await build('disabled').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'EMAIL_PROVIDER_DISABLED' });
    expect(await build('resend').adapter.send(msg({}))).toMatchObject({ status: 'failed', errorCode: 'MISSING_EMAIL_RECIPIENT' });
    expect(await build('mailchimp').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_EMAIL_PROVIDER' });
    expect(await build('webhook', null).adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_URL_MISSING' });
  });

  it('resend: éxito devuelve sent con el id; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('resend');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { id: 're_1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'resend', providerMessageId: 're_1' });

    const bad = build('resend');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'RESEND_SEND_FAILED' });
  });

  it('sendgrid: éxito y fallo', async () => {
    const ok = build('sendgrid');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 202, json: { id: 'sg_1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'sendgrid' });
    const bad = build('sendgrid');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'SENDGRID_SEND_FAILED' });
  });

  it('gmail_api: token inválido, token ok + envío ok, y token ok + envío fallido', async () => {
    // token responde 200 pero sin access_token -> GMAIL_TOKEN_FAILED
    const noTok = build('gmail_api');
    (noTok.executor.run as jest.Mock).mockResolvedValueOnce({ status: 200, json: {} } as never);
    expect(await noTok.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_TOKEN_FAILED' });

    // token ok + envío ok -> sent
    const ok = build('gmail_api');
    (ok.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockResolvedValueOnce({ status: 200, json: { id: 'gm_1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'gmail_api', providerMessageId: 'gm_1' });

    // token ok + envío fallido (executor rechaza en el 2º call) -> GMAIL_SEND_FAILED
    const bad = build('gmail_api');
    (bad.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockRejectedValueOnce(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_SEND_FAILED' });
  });

  it('webhook: con url configurada, éxito devuelve sent(webhook_email); fallo -> WEBHOOK_EMAIL_FAILED', async () => {
    const ok = build('webhook', 'https://hook.example');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { id: 'wh_1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'webhook_email', providerMessageId: 'wh_1' });
    const bad = build('webhook', 'https://hook.example');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_EMAIL_FAILED' });
  });
});
