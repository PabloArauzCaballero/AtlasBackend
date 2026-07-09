import { describe, expect, it, jest } from '@jest/globals';
import { withRetry } from '../../../src/common/resilience/retry.util.js';
import { AdapterError } from '../../../src/common/resilience/adapter-error.js';

function instantSleep() {
  return Promise.resolve();
}

describe('withRetry', () => {
  it('returns the result immediately on first success, without sleeping', async () => {
    const sleep = jest.fn(instantSleep);
    const fn = jest.fn(async () => 'ok');

    const result = await withRetry(fn, { provider: 'p', maxAttempts: 3, baseDelayMs: 100, sleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a retryable error up to maxAttempts, then succeeds', async () => {
    const sleep = jest.fn(instantSleep);
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw new AdapterError({ code: 'NETWORK', provider: 'p', message: 'down', retryable: true });
      return 'recovered';
    });

    const result = await withRetry(fn, { provider: 'p', maxAttempts: 5, baseDelayMs: 10, sleep });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and throws the last AdapterError', async () => {
    const sleep = jest.fn(instantSleep);
    const fn = jest.fn(async () => {
      throw new AdapterError({ code: 'NETWORK', provider: 'p', message: 'still down', retryable: true });
    });

    await expect(withRetry(fn, { provider: 'p', maxAttempts: 3, baseDelayMs: 10, sleep })).rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable error — fails immediately on first attempt', async () => {
    const sleep = jest.fn(instantSleep);
    const fn = jest.fn(async () => {
      throw new AdapterError({ code: 'AUTH_FAILED', provider: 'p', message: 'bad creds', retryable: false });
    });

    await expect(withRetry(fn, { provider: 'p', maxAttempts: 5, baseDelayMs: 10, sleep })).rejects.toThrow('bad creds');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('normalizes a plain thrown error (not already an AdapterError) before deciding retryability', async () => {
    const sleep = jest.fn(instantSleep);
    const netError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw netError;
      return 'ok';
    });

    const result = await withRetry(fn, { provider: 'p', maxAttempts: 3, baseDelayMs: 10, sleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('caps delay at maxDelayMs even with high attempt numbers', async () => {
    const delays: number[] = [];
    const sleep = jest.fn(async (ms: number) => {
      delays.push(ms);
    });
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 6) throw new AdapterError({ code: 'NETWORK', provider: 'p', message: 'down', retryable: true });
      return 'ok';
    });

    await withRetry(fn, { provider: 'p', maxAttempts: 6, baseDelayMs: 1000, maxDelayMs: 2000, jitterRatio: 0, sleep });

    expect(delays.every((delay) => delay <= 2000)).toBe(true);
  });
});
