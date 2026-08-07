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
  function build(provider: string, webhookUrl: string | null = null) {
    const config = { getSmsProvider: () => provider, require: () => 'val', getWebhookUrl: () => webhookUrl };
    const executor = { run: jest.fn() };
    return { adapter: new SmsNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { phone: '+591700' }) => ({ id: '1', channel: 'sms', body: 'hi', payload }) as never;

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
});
