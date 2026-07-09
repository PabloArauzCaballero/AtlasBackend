import { describe, expect, it } from '@jest/globals';
import { CircuitBreaker, CircuitBreakerRegistry } from '../../../src/common/resilience/circuit-breaker.js';
import { AdapterError } from '../../../src/common/resilience/adapter-error.js';

function makeClock(startMs = 0) {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe('CircuitBreaker', () => {
  it('starts closed and allows calls through', async () => {
    const breaker = new CircuitBreaker({ provider: 'p', failureThreshold: 3, resetTimeoutMs: 1000 });
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('opens after N consecutive failures and rejects further calls with CIRCUIT_OPEN', async () => {
    const breaker = new CircuitBreaker({ provider: 'p', failureThreshold: 2, resetTimeoutMs: 10_000 });
    await expect(breaker.execute(async () => Promise.reject(new Error('fail 1')))).rejects.toThrow('fail 1');
    await expect(breaker.execute(async () => Promise.reject(new Error('fail 2')))).rejects.toThrow('fail 2');

    expect(breaker.getState()).toBe('open');
    await expect(breaker.execute(async () => 'should not run')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' } as Partial<AdapterError>);
  });

  it('a success resets the consecutive failure counter (does not open on unrelated later failures below threshold)', async () => {
    const breaker = new CircuitBreaker({ provider: 'p', failureThreshold: 2, resetTimeoutMs: 10_000 });
    await expect(breaker.execute(async () => Promise.reject(new Error('fail')))).rejects.toThrow();
    await breaker.execute(async () => 'ok');
    await expect(breaker.execute(async () => Promise.reject(new Error('fail again')))).rejects.toThrow();
    expect(breaker.getState()).toBe('closed');
  });

  it('transitions to half_open after resetTimeoutMs, and a successful trial call closes it again', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ provider: 'p', failureThreshold: 1, resetTimeoutMs: 5000, now: clock.now });
    await expect(breaker.execute(async () => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    clock.advance(5000);
    expect(breaker.getState()).toBe('half_open');

    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('closed');
  });

  it('a failed trial call while half_open re-opens the circuit', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ provider: 'p', failureThreshold: 1, resetTimeoutMs: 5000, now: clock.now });
    await expect(breaker.execute(async () => Promise.reject(new Error('fail 1')))).rejects.toThrow();
    clock.advance(5000);
    expect(breaker.getState()).toBe('half_open');

    await expect(breaker.execute(async () => Promise.reject(new Error('fail again')))).rejects.toThrow();
    expect(breaker.getState()).toBe('open');
  });
});

describe('CircuitBreakerRegistry', () => {
  it('creates one breaker per provider and reuses it across calls', () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 3, resetTimeoutMs: 1000 });
    const a1 = registry.getOrCreate('sendgrid');
    const a2 = registry.getOrCreate('sendgrid');
    const b = registry.getOrCreate('twilio');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('reports "never_used" for a provider with no breaker created yet', () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(registry.getState('unknown')).toBe('never_used');
  });
});
