import { describe, expect, it } from '@jest/globals';
import { base64Url } from '../../../src/common/utils/crypto/encoding.util.js';

/** `base64Url`: base64 sin padding y con alfabeto URL-safe (- _), acepta Buffer o string. */
describe('base64Url', () => {
  it('codifica un string sin =, + ni /', () => {
    const out = base64Url('subjects?>>>');
    expect(out).not.toMatch(/[=+/]/);
    // round-trip: al re-agregar padding y revertir el alfabeto, se recupera el original
    const b64 = out.replace(/-/g, '+').replace(/_/g, '/');
    expect(Buffer.from(b64, 'base64').toString()).toBe('subjects?>>>');
  });

  it('acepta un Buffer y produce el alfabeto URL-safe', () => {
    const out = base64Url(Buffer.from([0xff, 0xfe, 0xfd]));
    expect(out).toBe('__79');
  });
});
