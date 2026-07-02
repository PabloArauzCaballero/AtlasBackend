import { describe, expect, it } from '@jest/globals';
import { sha256Hex } from '../../src/common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../src/common/utils/privacy/redaction.util.js';

function requestHash(input: unknown): string {
  return sha256Hex(stableStringify(redactSensitiveObject(input)));
}

describe('idempotency request hash', () => {
  it('is stable for equivalent payloads regardless of key order', () => {
    expect(requestHash({ b: 2, a: 1 })).toBe(requestHash({ a: 1, b: 2 }));
  });

  it('does not depend on raw sensitive values after redaction', () => {
    expect(requestHash({ phone: '+59170000000' })).toBe(requestHash({ phone: '+59179999999' }));
  });
});
