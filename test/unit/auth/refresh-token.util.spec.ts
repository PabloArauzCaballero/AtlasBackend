import { describe, expect, it } from '@jest/globals';
import { generateRefreshToken, hashRefreshToken } from '../../../src/common/utils/crypto/refresh-token.util.js';

describe('refresh-token.util', () => {
  it('generates high-entropy, unique tokens on each call', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hashRefreshToken is deterministic for the same input', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('hashRefreshToken never returns the original token value', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).not.toBe(token);
  });

  it('hashRefreshToken produces different hashes for different tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});
