/**
 * @file Verifica cuándo un consentimiento ampara usar un dato ya guardado.
 * @business Quien retira el permiso de su agenda o su ubicación deja de pesar en las decisiones por lo que entregó antes.
 * @system Ejercita `isConsentInForce` (función pura sobre la última fila de consentimiento de una finalidad).
 */
import { describe, expect, it } from '@jest/globals';
import { isConsentInForce } from '../../../src/common/utils/consent/consent-in-force.util.js';

describe('isConsentInForce', () => {
  it('concedido y sin retirar: vigente', () => {
    expect(isConsentInForce({ granted: true, revokedAt: null })).toBe(true);
  });

  it.each([
    ['retirado', { granted: true, revokedAt: new Date() }],
    ['la última decisión fue un «no»', { granted: false, revokedAt: null }],
    ['decisión sin valor', { granted: null, revokedAt: null }],
    ['nunca se le preguntó', null],
    ['sin fila', undefined],
  ])('%s: no vigente', (_caso, fila) => {
    expect(isConsentInForce(fila)).toBe(false);
  });
});
