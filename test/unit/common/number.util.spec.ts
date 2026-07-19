import { describe, expect, it } from '@jest/globals';
import { toNumberOrNull } from '../../../src/common/utils/numbers/number.util.js';

/** `toNumberOrNull`: null pasa, number finito pasa, string se parsea, no-finito/NaN -> null. */
describe('toNumberOrNull', () => {
  it('devuelve null tal cual', () => {
    expect(toNumberOrNull(null)).toBeNull();
  });
  it('conserva un number finito', () => {
    expect(toNumberOrNull(42)).toBe(42);
    expect(toNumberOrNull(0)).toBe(0);
  });
  it('parsea un string numérico', () => {
    expect(toNumberOrNull('3.14')).toBe(3.14);
  });
  it('devuelve null para no-finitos o strings no numéricos', () => {
    expect(toNumberOrNull('abc')).toBeNull();
    expect(toNumberOrNull(Infinity)).toBeNull();
    expect(toNumberOrNull(NaN)).toBeNull();
  });
});
