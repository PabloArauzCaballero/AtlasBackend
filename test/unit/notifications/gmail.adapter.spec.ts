import { describe, expect, it, jest } from '@jest/globals';
import { AdapterError } from '../../../src/common/resilience/adapter-error.js';
import { GmailApiAdapter } from '../../../src/modules/notifications/adapters/gmail/gmail.adapter.js';
import { GmailOAuthTokenService } from '../../../src/modules/notifications/adapters/gmail/gmail-oauth-token.service.js';
import type { GmailCredentialsResult } from '../../../src/modules/notifications/adapters/notification-provider-config.service.js';

/**
 * `GmailApiAdapter` + `GmailOAuthTokenService` con el executor de resiliencia mockeado: resolver =
 * HTTP ok, rechazar = HTTP fallido. Se ejercitan el canje OAuth (cache, in-flight, invalidación por
 * 401) y las ramas de fallo que el orquestador persiste como `DeliveryResult`.
 */
describe('GmailApiAdapter', () => {
  const CREDENTIALS: GmailCredentialsResult = {
    ok: true,
    value: { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt', fromEmail: 'atlas@example.com' },
  };

  function build(credentials: GmailCredentialsResult = CREDENTIALS, emailProvider = 'gmail_api') {
    const executor = { run: jest.fn() };
    const config = { getGmailCredentials: () => credentials, getEmailProvider: () => emailProvider };
    const tokens = new GmailOAuthTokenService(executor as never);
    return { adapter: new GmailApiAdapter(config as never, tokens, executor as never), executor, tokens };
  }

  const msg = (overrides: Record<string, unknown> = {}) =>
    ({ id: 'msg-1', channel: 'email', subject: 'S', body: 'b', payload: { email: 'dest@example.com' }, ...overrides }) as never;

  const okToken = { status: 200, json: { access_token: 'tok', expires_in: 3600 } } as never;
  const okSend = { status: 200, json: { id: 'gm_1', threadId: 'th_1' } } as never;
  /** Lo que `callResilient` propaga tras un 401: `AUTH_FAILED` no reintentable con su httpStatus. */
  const unauthorized = () =>
    new AdapterError({ code: 'AUTH_FAILED', provider: 'gmail_api', message: 'HTTP 401', retryable: false, httpStatus: 401 }) as never;

  it('contrato de adaptador: proveedor, canal y validación de payload', () => {
    const { adapter } = build();
    expect(adapter.getProviderName()).toBe('gmail_api');
    expect(adapter.supports('email')).toBe(true);
    expect(adapter.supports('sms')).toBe(false);
    expect(adapter.validatePayload({ channel: 'email', subject: 'S', body: 'b' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'email', subject: '', body: 'b' } as never)).toBe(false);
    expect(adapter.isConfigured()).toBe(true);
    expect(build({ ok: false, missing: 'GMAIL_CLIENT_ID_MISSING' }).adapter.isConfigured()).toBe(false);
  });

  describe('selección por NOTIFICATION_EMAIL_PROVIDER', () => {
    it('isEnabled() exige que Gmail sea el proveedor elegido Y tenga credenciales', () => {
      expect(build(CREDENTIALS, 'gmail_api').adapter.isEnabled()).toBe(true);
      expect(build(CREDENTIALS, 'resend').adapter.isEnabled()).toBe(false);
      expect(build(CREDENTIALS, 'disabled').adapter.isEnabled()).toBe(false);
      // Elegido pero sin credenciales: tampoco está operativo.
      expect(build({ ok: false, missing: 'GMAIL_CLIENT_ID_MISSING' }, 'gmail_api').adapter.isEnabled()).toBe(false);
    });

    it.each(['disabled', 'resend', 'sendgrid', 'webhook'])(
      'con NOTIFICATION_EMAIL_PROVIDER=%s no envía aunque las credenciales estén presentes',
      async (provider) => {
        const { adapter, executor } = build(CREDENTIALS, provider);
        const result = await adapter.send(msg());
        expect(result).toMatchObject({ status: 'failed', errorCode: 'GMAIL_PROVIDER_NOT_SELECTED' });
        expect(result.errorMessage).toContain(provider);
        expect(executor.run).not.toHaveBeenCalled();
      },
    );

    it('la guarda también cubre la entrada directa por sendEmail(), no solo send()', async () => {
      const { adapter, executor } = build(CREDENTIALS, 'disabled');
      await expect(adapter.sendEmail({ to: ['dest@example.com'], subject: 'S', text: 'b', boundarySeed: 'x' })).rejects.toMatchObject({
        code: 'GMAIL_PROVIDER_NOT_SELECTED',
      });
      expect(executor.run).not.toHaveBeenCalled();
    });

    it('la selección se relee en cada envío: apagar el canal en caliente corta los envíos', async () => {
      let provider = 'gmail_api';
      const executor = { run: jest.fn() };
      const config = { getGmailCredentials: () => CREDENTIALS, getEmailProvider: () => provider };
      const adapter = new GmailApiAdapter(config as never, new GmailOAuthTokenService(executor as never), executor as never);
      (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockResolvedValueOnce(okSend);
      expect(await adapter.send(msg())).toMatchObject({ status: 'sent' });
      provider = 'disabled';
      expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_PROVIDER_NOT_SELECTED' });
      expect(executor.run).toHaveBeenCalledTimes(2);
    });
  });

  it('camino feliz: canjea el token, envía y devuelve sent con el id de Gmail', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockResolvedValueOnce(okSend);
    expect(await adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'gmail_api', providerMessageId: 'gm_1' });
    expect(executor.run).toHaveBeenCalledTimes(2);
  });

  it('reutiliza el access token cacheado: el segundo envío no vuelve a canjear', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockResolvedValue(okSend);
    await adapter.send(msg());
    await adapter.send(msg());
    // 1 canje + 2 envíos, no 2 canjes.
    expect(executor.run).toHaveBeenCalledTimes(3);
  });

  it('envíos concurrentes en frío comparten un único canje de token', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockResolvedValue(okSend);
    await Promise.all([adapter.send(msg()), adapter.send(msg()), adapter.send(msg())]);
    expect(executor.run).toHaveBeenCalledTimes(4);
  });

  it('un 401 de Gmail invalida el token y reintenta una vez con uno fresco', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce(okToken)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(okToken)
      .mockResolvedValueOnce(okSend);
    expect(await adapter.send(msg())).toMatchObject({ status: 'sent', providerMessageId: 'gm_1' });
    expect(executor.run).toHaveBeenCalledTimes(4);
  });

  it('un segundo 401 ya no se reintenta: se reporta GMAIL_SEND_FAILED', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce(okToken)
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(okToken)
      .mockRejectedValueOnce(unauthorized());
    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_SEND_FAILED' });
    expect(executor.run).toHaveBeenCalledTimes(4);
  });

  it('refresh token revocado: el canje falla y no se intenta el envío', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce({ status: 200, json: { error: 'invalid_grant' } } as never);
    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_TOKEN_FAILED' });
    expect(executor.run).toHaveBeenCalledTimes(1);
  });

  it('un canje fallido no se cachea: el siguiente envío vuelve a intentarlo', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: {} } as never)
      .mockResolvedValueOnce(okToken)
      .mockResolvedValueOnce(okSend);
    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_TOKEN_FAILED' });
    expect(await adapter.send(msg())).toMatchObject({ status: 'sent' });
  });

  it('sin credenciales devuelve el código de la variable ausente, no una excepción', async () => {
    const { adapter, executor } = build({ ok: false, missing: 'GMAIL_REFRESH_TOKEN_MISSING' });
    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'GMAIL_REFRESH_TOKEN_MISSING' });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('sin destinatario resoluble no toca la red', async () => {
    const { adapter, executor } = build();
    expect(await adapter.send(msg({ payload: {} }))).toMatchObject({ status: 'failed', errorCode: 'MISSING_EMAIL_RECIPIENT' });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('rechaza destinatarios con formato inválido sin filtrar la dirección en el error', async () => {
    const { adapter, executor } = build();
    const result = await adapter.send(msg({ payload: { email: 'dest@example.com, atacante@evil.com' } }));
    expect(result).toMatchObject({ status: 'failed', errorCode: 'GMAIL_INVALID_RECIPIENT' });
    expect(result.errorMessage).not.toContain('atacante@evil.com');
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('propaga html, cc, bcc y replyTo del payload al MIME enviado', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockResolvedValueOnce(okSend);
    await adapter.send(
      msg({
        payload: { email: 'dest@example.com', html: '<b>hola</b>', cc: 'c@x.com', bcc: ['e@x.com'], replyTo: 'reply@x.com' },
      }),
    );
    // El executor recibe un thunk; se ejecuta el `fn` del 2º call para capturar el body real.
    const sendCall = (executor.run as jest.Mock).mock.calls[1] as [() => Promise<unknown>, { provider: string }];
    expect(sendCall[1].provider).toBe('gmail_api');
    const raw = await capturedRaw(executor, 1);
    expect(raw).toContain('Cc: c@x.com');
    expect(raw).toContain('Bcc: e@x.com');
    expect(raw).toContain('Reply-To: reply@x.com');
    expect(raw).toContain('multipart/alternative');
  });

  it('sendEmail lanza GmailAdapterError con la respuesta del proveedor', async () => {
    const { adapter, executor } = build();
    (executor.run as jest.Mock).mockResolvedValueOnce(okToken).mockRejectedValueOnce(new Error('boom') as never);
    await expect(adapter.sendEmail({ to: ['dest@example.com'], subject: 'S', text: 'b', boundarySeed: 'x' })).rejects.toMatchObject({
      code: 'GMAIL_SEND_FAILED',
    });
  });

  /**
   * `postJson` construye el request y se lo pasa a `executor.run` dentro de un closure; para
   * inspeccionar el MIME hay que llegar al `fetch` que ese closure haría. Se intercepta `fetch`
   * global durante la ejecución del thunk capturado.
   */
  async function capturedRaw(executor: { run: jest.Mock }, callIndex: number): Promise<string> {
    const globalWithFetch = globalThis as unknown as { fetch: unknown };
    const original = globalWithFetch.fetch;
    let body = '';
    globalWithFetch.fetch = ((_url: string, init: { body: string }) => {
      body = init.body;
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') });
    }) as unknown;
    try {
      // Se AWAITA el thunk: `fetchOnce` arma un setTimeout de timeout que solo se limpia en su
      // `finally`. Abandonar la promesa dejaría el handle vivo y Jest avisaría del worker colgado.
      await (executor.run.mock.calls[callIndex] as [() => Promise<unknown>])[0]();
    } finally {
      globalWithFetch.fetch = original;
    }
    const raw = JSON.parse(body).raw as string;
    return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
});
