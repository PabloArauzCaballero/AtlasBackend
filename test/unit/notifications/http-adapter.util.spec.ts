import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { postJson } from '../../../src/modules/notifications/adapters/http-adapter.util.js';

describe('postJson — reintentos de un envío', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('no repite el POST cuando se agotó el plazo: pudo haber llegado y se cobraría dos veces', async () => {
    const fetchMock = jest.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    });
    global.fetch = fetchMock as never;
    const result = await postJson(new ResilientAdapterExecutorService(), 'twilio-test-1', 'http://x.test', {}, { a: 1 });
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sí repite el POST ante un 503, que el proveedor no procesó', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 503 }));
    global.fetch = fetchMock as never;
    const result = await postJson(new ResilientAdapterExecutorService(), 'twilio-test-2', 'http://x.test', {}, { a: 1 });
    expect(result.ok).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
