import { describe, expect, it, jest } from '@jest/globals';
import { EmailNotificationAdapter } from '../../../src/modules/notifications/adapters/email.adapter.js';

/**
 * `EmailNotificationAdapter.send`: ramas de guarda (disabled / sin destinatario / proveedor no
 * soportado / webhook sin url) y el camino Resend (éxito y fallo). Executor mockeado: resolver = HTTP
 * ok, rechazar = HTTP fallo.
 *
 * El camino `gmail_api` solo se verifica como DELEGACIÓN: su comportamiento real (OAuth, MIME,
 * reintento por 401) vive en `GmailApiAdapter` y se prueba en `gmail.adapter.spec.ts`.
 */
describe('EmailNotificationAdapter', () => {
  function build(provider: string, webhookUrl: string | null = null) {
    const config = {
      getEmailProvider: () => provider,
      require: () => 'val',
      getWebhookUrl: () => webhookUrl,
      getSendGridConfig: () => ({
        ok: true,
        value: { apiKey: 'SG.k', fromEmail: 'no-reply@atlas.test', fromName: null, replyToEmail: null },
      }),
    };
    const executor = { run: jest.fn() };
    const gmail = { send: jest.fn() };
    return {
      adapter: new EmailNotificationAdapter(config as never, executor as never, gmail as never),
      executor,
      gmail,
      adapterConfig: config as Record<string, unknown>,
    };
  }

  /**
   * El cuerpo que el adaptador puso en la llamada saliente.
   *
   * `postJson` serializa el objeto a JSON antes de dárselo al executor, así que hay que ejecutar el
   * thunk con `fetch` mockeado para verlo. Se AWAITA: `fetchOnce` arma un timeout que sólo se limpia
   * en su `finally`.
   */
  async function capturarCuerpo(executor: { run: jest.Mock }): Promise<Record<string, unknown>> {
    const globalWithFetch = globalThis as unknown as { fetch: unknown };
    const original = globalWithFetch.fetch;
    let enviado = '';
    globalWithFetch.fetch = ((_url: string, init: { body: string }) => {
      enviado = init.body;
      return Promise.resolve({ status: 202, ok: true, text: () => Promise.resolve('') });
    }) as unknown;
    try {
      // Se AWAITA el thunk: `fetchOnce` arma un setTimeout que sólo se limpia en su `finally`.
      // Abandonar la promesa dejaría el handle vivo y Jest avisaría del worker colgado.
      await (executor.run.mock.calls[0] as [() => Promise<unknown>])[0]();
    } finally {
      globalWithFetch.fetch = original;
    }
    return JSON.parse(enviado) as Record<string, unknown>;
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

  /**
   * SendGrid acepta con `202` y CUERPO VACÍO: el identificador viaja en la cabecera `X-Message-Id`.
   * Antes se guardaba en su lugar el id interno de ATLAS —un valor que ningún evento de SendGrid
   * menciona—, así que ningún rebote se podía atribuir a su correo. Esta prueba fija que el id sale
   * de la cabecera y que un 202 sin cabecera deja `null`, no un id inventado.
   */
  it('sendgrid: el providerMessageId sale de la cabecera X-Message-Id, no del cuerpo', async () => {
    const ok = build('sendgrid');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 202, json: {}, headers: { 'x-message-id': 'sg-abc123' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'sendgrid', providerMessageId: 'sg-abc123' });

    const sinCabecera = build('sendgrid');
    (sinCabecera.executor.run as jest.Mock).mockResolvedValue({ status: 202, json: {}, headers: {} } as never);
    expect(await sinCabecera.adapter.send(msg())).toMatchObject({ providerMessageId: null });
  });

  it('sendgrid: el fallo lleva el motivo que dio SendGrid, no sólo el status', async () => {
    const bad = build('sendgrid');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'SENDGRID_SEND_FAILED' });
  });

  it('sendgrid: sin credenciales devuelve el código de la variable que falta, sin llamar a nadie', async () => {
    const sinClave = build('sendgrid');
    sinClave.adapterConfig.getSendGridConfig = () => ({ ok: false, missing: 'SENDGRID_API_KEY_MISSING' });
    expect(await sinClave.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'SENDGRID_API_KEY_MISSING' });
    expect(sinClave.executor.run).not.toHaveBeenCalled();
  });

  /**
   * El cuerpo que se le manda a SendGrid: `text/plain` ANTES que `text/html` (SendGrid responde 400
   * al revés) y el id de ATLAS en `custom_args`, que es lo que devuelve cada evento del webhook y
   * permite atribuir un rebote a su mensaje.
   */
  it('sendgrid: manda texto y HTML en orden, copias, reply-to y el id de ATLAS en custom_args', async () => {
    const ok = build('sendgrid');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 202, json: {}, headers: {} } as never);
    await ok.adapter.send(msg({ email: 'a@x.com', html: '<p>hola</p>', cc: 'c@x.com', bcc: ['b@x.com'], replyTo: 'responde@atlas.test' }));
    const cuerpo = await capturarCuerpo(ok.executor);
    expect(cuerpo.content).toEqual([
      { type: 'text/plain', value: 'b' },
      { type: 'text/html', value: '<p>hola</p>' },
    ]);
    expect(cuerpo.personalizations).toEqual([{ to: [{ email: 'a@x.com' }], cc: [{ email: 'c@x.com' }], bcc: [{ email: 'b@x.com' }] }]);
    expect(cuerpo.reply_to).toEqual({ email: 'responde@atlas.test' });
    expect(cuerpo.custom_args).toEqual({ atlas_message_id: '1' });
  });

  it('gmail_api: delega en GmailApiAdapter y devuelve su resultado tal cual', async () => {
    const { adapter, gmail, executor } = build('gmail_api');
    const delivered = { status: 'sent', provider: 'gmail_api', providerMessageId: 'gm_1' };
    (gmail.send as jest.Mock).mockResolvedValue(delivered as never);
    const message = msg();
    expect(await adapter.send(message)).toBe(delivered);
    expect(gmail.send).toHaveBeenCalledWith(message);
    // El adaptador multi-proveedor no hace ninguna llamada saliente propia por Gmail.
    expect(executor.run).not.toHaveBeenCalled();
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
