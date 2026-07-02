import { describe, expect, it } from '@jest/globals';
import { redactSensitiveObject, stableStringify } from '../../src/common/utils/privacy/redaction.util.js';

describe('redactSensitiveObject', () => {
  it('redacts sensitive nested fields but keeps safe fields visible', () => {
    const result = redactSensitiveObject({
      email: 'demo@atlas.test',
      profile: { firstName: 'Ana', phone: '+59170000000' },
      safe: 'visible',
    }) as Record<string, unknown>;

    expect(result.email).toBe('[REDACTED]');
    expect(result.profile).toEqual({ firstName: 'Ana', phone: '[REDACTED]' });
    expect(result.safe).toBe('visible');
  });
});

describe('stableStringify', () => {
  it('keeps deterministic key order regardless of insertion order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });
});
