import { describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { AdapterError } from '../../../src/common/resilience/adapter-error.js';

describe('ResilientAdapterExecutorService', () => {
  it('runs the function successfully and reports the circuit as closed', async () => {
    const service = new ResilientAdapterExecutorService();
    const result = await service.run(async () => 'ok', { provider: 'sendgrid' });
    expect(result).toBe('ok');
    expect(service.circuitStateFor('sendgrid')).toBe('closed');
  });

  it('retries a retryable failure per the provided options before succeeding', async () => {
    const service = new ResilientAdapterExecutorService();
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw new AdapterError({ code: 'NETWORK', provider: 'twilio', message: 'blip', retryable: true });
      return 'ok';
    });

    const result = await service.run(fn, { provider: 'twilio', maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit for a provider after repeated failures, independent of other providers', async () => {
    const service = new ResilientAdapterExecutorService();
    const failing = () =>
      service.run(
        async () => {
          throw new AdapterError({ code: 'PROVIDER_ERROR', provider: 'infocenter', message: 'down', retryable: false });
        },
        { provider: 'infocenter', maxAttempts: 1 },
      );

    for (let i = 0; i < 5; i += 1) {
      await expect(failing()).rejects.toThrow();
    }

    expect(service.circuitStateFor('infocenter')).toBe('open');
    expect(service.circuitStateFor('segip')).toBe('never_used');
  });
});
