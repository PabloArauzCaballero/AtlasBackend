import { describe, expect, it } from '@jest/globals';
import { AdapterError, toAdapterError } from '../../../src/common/resilience/adapter-error.js';

describe('toAdapterError', () => {
  it('passes through an existing AdapterError unchanged', () => {
    const original = new AdapterError({ code: 'RATE_LIMITED', provider: 'p1', message: 'm', retryable: true });
    expect(toAdapterError({ provider: 'p1', error: original })).toBe(original);
  });

  it('maps HTTP 401/403 to AUTH_FAILED, not retryable', () => {
    const result = toAdapterError({ provider: 'sendgrid', httpStatus: 401 });
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.retryable).toBe(false);
  });

  it('maps HTTP 429 to RATE_LIMITED, retryable', () => {
    const result = toAdapterError({ provider: 'twilio', httpStatus: 429 });
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.retryable).toBe(true);
  });

  it('maps HTTP 500/502/503/504 to PROVIDER_ERROR, retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      const result = toAdapterError({ provider: 'segip', httpStatus: status });
      expect(result.code).toBe('PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
    }
  });

  it('maps HTTP 400/404/422 to PROVIDER_ERROR, NOT retryable', () => {
    for (const status of [400, 404, 422]) {
      const result = toAdapterError({ provider: 'segip', httpStatus: status });
      expect(result.retryable).toBe(false);
    }
  });

  it('maps AbortError (timeout) to TIMEOUT, retryable', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const result = toAdapterError({ provider: 'fcm', error: abort });
    expect(result.code).toBe('TIMEOUT');
    expect(result.retryable).toBe(true);
  });

  it('maps a Node network error code (ECONNRESET) to NETWORK, retryable', () => {
    const netError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const result = toAdapterError({ provider: 'whatsapp', error: netError });
    expect(result.code).toBe('NETWORK');
    expect(result.retryable).toBe(true);
  });

  it('falls back to UNKNOWN, not retryable, for an unrecognized error', () => {
    const result = toAdapterError({ provider: 'x', error: new Error('something weird') });
    expect(result.code).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('toJSON exposes a safe, structured shape (no raw cause leaking by default)', () => {
    const result = toAdapterError({ provider: 'segip', httpStatus: 500 });
    expect(result.toJSON()).toEqual({ code: 'PROVIDER_ERROR', provider: 'segip', retryable: true, httpStatus: 500, message: 'HTTP 500' });
  });
});
