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
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
      return new Response(JSON.stringify({ id: 'webhook-msg-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(buildConfig('https://hooks.example.com/sms') as never, new ResilientAdapterExecutorService());

    const result = await adapter.send(message);

    expect(calls).toBe(2);
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toBe('webhook-msg-1');
  });

  it('gives up after exhausting retries on a persistent 503 and returns a failed delivery, never throwing', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ error: 'down' }), { status: 503 })) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(buildConfig('https://hooks.example.com/sms') as never, new ResilientAdapterExecutorService());

    const result = await adapter.send(message);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WEBHOOK_SMS_FAILED');
    expect((result.response as { code?: string } | null)?.code).toBe('PROVIDER_ERROR');
  });

  it('does NOT retry a 401 (non-retryable) — fails on the first attempt', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }) as unknown as typeof fetch;

    const adapter = new SmsNotificationAdapter(buildConfig('https://hooks.example.com/sms') as never, new ResilientAdapterExecutorService());

    const result = await adapter.send(message);

    expect(calls).toBe(1);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WEBHOOK_SMS_FAILED');
    expect((result.response as { code?: string } | null)?.code).toBe('AUTH_FAILED');
  });
});
