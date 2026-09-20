import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { SmsNotificationAdapter } from '../../../src/modules/notifications/adapters/sms.adapter.js';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';

/**
 * ATLAS-ROBUSTEZ: `SmsNotificationAdapter` (y los otros 3 adapters de canal) ahora enrutan sus
 * llamadas HTTP salientes a través de `ResilientAdapterExecutorService` (retry+backoff +
 * circuit breaker por proveedor, kernel compartido en `src/common/resilience/`). Este test
 * verifica el flujo end-to-end con el executor REAL (no mockeado) contra un `fetch` global
 * mockeado — confirma que un 503 transitorio se reintenta y termina en éxito, sin que el
 * adapter tenga que saber nada sobre retry.
 */
describe('SmsNotificationAdapter — webhook channel routed through the resilience kernel', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function buildConfig(webhookUrl: string | undefined) {
    return {
      getSmsProvider: () => 'webhook' as const,
      getWebhookUrl: () => webhookUrl,
      require: (value: string | undefined, code: string) => {
        if (!value) throw new Error(code);
        return value;
      },
    };
  }

  const message = { id: 'msg-1', channel: 'sms', body: 'hola', payload: { phone: '+59170000000' } } as never;

  it('retries once on a transient 503 and then succeeds', async () => {
    let calls = 0;
    global.fetch = jest.fn(async (..._args: unknown[]) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
      return new Response(JSON.stringify({ id: 'webhook-msg-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(
      buildConfig('https://hooks.example.com/sms') as never,
      new ResilientAdapterExecutorService(),
    );

    const result = await adapter.send(message);

    expect(calls).toBe(2);
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toBe('webhook-msg-1');
  });

  it('gives up after exhausting retries on a persistent 503 and returns a failed delivery, never throwing', async () => {
    global.fetch = jest.fn(
      async (..._args: unknown[]) => new Response(JSON.stringify({ error: 'down' }), { status: 503 }),
    ) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(
      buildConfig('https://hooks.example.com/sms') as never,
      new ResilientAdapterExecutorService(),
    );

    const result = await adapter.send(message);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WEBHOOK_SMS_FAILED');
    expect((result.response as { code?: string } | null)?.code).toBe('PROVIDER_ERROR');
  });

  it('does NOT retry a 401 (non-retryable) — fails on the first attempt', async () => {
    let calls = 0;
    global.fetch = jest.fn(async (..._args: unknown[]) => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(
      buildConfig('https://hooks.example.com/sms') as never,
      new ResilientAdapterExecutorService(),
    );

    const result = await adapter.send(message);

    expect(calls).toBe(1);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WEBHOOK_SMS_FAILED');
    expect((result.response as { code?: string } | null)?.code).toBe('AUTH_FAILED');
  });
});

describe('SmsNotificationAdapter — guardas y camino Twilio (executor mockeado)', () => {
  const TWILIO_OK = {
    ok: true as const,
    value: {
      accountSid: 'AC123',
      authToken: 'token',
      sender: { From: '+15550001111' },
      statusCallbackUrl: null,
      defaultCountryCode: '+591',
    },
  };

  function build(provider: string, webhookUrl: string | null = null, twilio: unknown = TWILIO_OK) {
    const config = {
      getSmsProvider: () => provider,
      require: () => 'val',
      getWebhookUrl: () => webhookUrl,
      getTwilioSmsConfig: () => twilio,
    };
    const executor = { run: jest.fn() };
    return { adapter: new SmsNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { phone: '+59170000000' }) => ({ id: '1', channel: 'sms', body: 'hi', payload }) as never;

  /** Los parámetros del formulario que el adaptador puso en la llamada a Twilio. */
  async function capturarParametros(executor: { run: jest.Mock }): Promise<URLSearchParams> {
    const globalWithFetch = globalThis as unknown as { fetch: unknown };
    const original = globalWithFetch.fetch;
    let enviado = '';
    globalWithFetch.fetch = ((_url: string, init: { body: string }) => {
      enviado = init.body;
      return Promise.resolve({ status: 201, ok: true, text: () => Promise.resolve('{"sid":"SM1"}') });
    }) as unknown;
    try {
      // Se AWAITA el thunk: `fetchOnce` arma un setTimeout que sólo se limpia en su `finally`.
      await (executor.run.mock.calls[0] as [() => Promise<unknown>])[0]();
    } finally {
      globalWithFetch.fetch = original;
    }
    return new URLSearchParams(enviado);
  }

  it('supports y validatePayload', () => {
    const { adapter } = build('twilio');
    expect(adapter.supports('sms')).toBe(true);
    expect(adapter.supports('email' as never)).toBe(false);
    expect(adapter.validatePayload({ channel: 'sms', body: 'hi' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'sms', body: '' } as never)).toBe(false);
  });

  it('ramas de guarda: disabled / sin destinatario / no soportado / webhook sin url', async () => {
    expect(await build('disabled').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'SMS_PROVIDER_DISABLED' });
    expect(await build('twilio').adapter.send(msg({}))).toMatchObject({ status: 'failed', errorCode: 'MISSING_SMS_RECIPIENT' });
    expect(await build('nexmo').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_SMS_PROVIDER' });
    expect(await build('webhook', null).adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_URL_MISSING' });
  });

  it('twilio: éxito devuelve sent con el sid; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('twilio');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { sid: 'SM1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'twilio_sms', providerMessageId: 'SM1' });

    const bad = build('twilio');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'TWILIO_SMS_SEND_FAILED' });
  });

  it('twilio: sin credenciales devuelve el código de la variable que falta, sin llamar a nadie', async () => {
    const sinConfig = build('twilio', null, { ok: false, missing: 'TWILIO_SMS_SENDER_MISSING' });
    expect(await sinConfig.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'TWILIO_SMS_SENDER_MISSING' });
    expect(sinConfig.executor.run).not.toHaveBeenCalled();
  });

  /**
   * Twilio sólo acepta E.164 y rechaza con `21211` —cobrando el intento— cualquier otra cosa. Los
   * teléfonos de ATLAS llegan en formato nacional o con separadores, así que la normalización es lo
   * que separa «el SMS sale» de «el SMS nunca salió y nadie sabe por qué».
   */
  it('twilio: normaliza el destinatario a E.164 con el país por defecto', async () => {
    const nacional = build('twilio');
    (nacional.executor.run as jest.Mock).mockResolvedValue({ status: 201, json: { sid: 'SM1' } } as never);
    await nacional.adapter.send(msg({ phone: '70000000' }));
    expect((await capturarParametros(nacional.executor)).get('To')).toBe('+59170000000');

    const conSeparadores = build('twilio');
    (conSeparadores.executor.run as jest.Mock).mockResolvedValue({ status: 201, json: { sid: 'SM1' } } as never);
    await conSeparadores.adapter.send(msg({ phone: '(591) 7000-0000' }));
    expect((await capturarParametros(conSeparadores.executor)).get('To')).toBe('+59170000000');

    const invalido = build('twilio');
    expect(await invalido.adapter.send(msg({ phone: '12' }))).toMatchObject({ status: 'failed', errorCode: 'INVALID_SMS_RECIPIENT' });
    expect(invalido.executor.run).not.toHaveBeenCalled();
  });

  it('twilio: con Messaging Service manda MessagingServiceSid y NO From (mandar los dos es un 400)', async () => {
    const conServicio = build('twilio', null, {
      ok: true,
      value: { ...TWILIO_OK.value, sender: { MessagingServiceSid: 'MG999' }, statusCallbackUrl: 'https://api.atlas.test/hook' },
    });
    (conServicio.executor.run as jest.Mock).mockResolvedValue({ status: 201, json: { sid: 'SM1' } } as never);
    await conServicio.adapter.send(msg());
    const parametros = await capturarParametros(conServicio.executor);
    expect(parametros.get('MessagingServiceSid')).toBe('MG999');
    expect(parametros.get('From')).toBeNull();
    expect(parametros.get('StatusCallback')).toBe('https://api.atlas.test/hook');
  });

  it('twilio: sin StatusCallback configurado el parámetro no viaja', async () => {
    const sinCallback = build('twilio');
    (sinCallback.executor.run as jest.Mock).mockResolvedValue({ status: 201, json: { sid: 'SM1' } } as never);
    await sinCallback.adapter.send(msg());
    expect((await capturarParametros(sinCallback.executor)).has('StatusCallback')).toBe(false);
  });

  /**
   * Un número inválido y una caída de Twilio llegan los dos como fallo HTTP, pero sólo uno se
   * arregla reintentando. El código del cuerpo (`21211`) es lo único que los distingue, y antes se
   * perdía entero: en `notification_deliveries` quedaba «HTTP 400» y nada más.
   */
  it('twilio: un código de rechazo del destinatario se distingue de un fallo de envío', async () => {
    const globalWithFetch = globalThis as unknown as { fetch: unknown };
    const original = globalWithFetch.fetch;
    // Executor REAL contra `fetch` mockeado: el cuerpo del error de Twilio tiene que sobrevivir todo
    // el transporte (kernel de resiliencia incluido) para llegar al adaptador, y eso es justo lo que
    // antes se perdía. Con el executor mockeado esta prueba no probaría nada.
    globalWithFetch.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number", status: 400 }), { status: 400 }),
      )) as unknown;
    try {
      const config = {
        getSmsProvider: () => 'twilio',
        getWebhookUrl: () => null,
        getTwilioSmsConfig: () => TWILIO_OK,
      };
      const adapter = new SmsNotificationAdapter(config as never, new ResilientAdapterExecutorService());
      const resultado = await adapter.send(msg());
      expect(resultado).toMatchObject({ status: 'failed', errorCode: 'TWILIO_SMS_RECIPIENT_REJECTED' });
      expect(resultado.errorMessage).toContain('21211');
      expect((resultado.response as { providerResponse?: { code?: number } } | null)?.providerResponse?.code).toBe(21211);
    } finally {
      globalWithFetch.fetch = original;
    }
  });
});
