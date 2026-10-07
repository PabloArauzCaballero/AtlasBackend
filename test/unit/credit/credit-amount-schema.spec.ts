/**
 * @file El importe pedido y los rangos de producto no admiten fracciones de centavo: no se redondean en silencio.
 */
import { describe, expect, it } from '@jest/globals';
import { createCreditApplicationSchema } from '../../../src/modules/credit/credit.schemas.js';

describe('importe de la solicitud de crédito', () => {
  const base = { productId: '1', requestedTermMonths: 12 };
  const probar = (requestedAmount: number) => createCreditApplicationSchema.safeParse({ ...base, requestedAmount }).success;

  it('acepta importes con hasta dos decimales', () => {
    expect(probar(1000)).toBe(true);
    expect(probar(1000.5)).toBe(true);
    expect(probar(1234.56)).toBe(true);
    expect(probar(0.01)).toBe(true);
  });

  it('rechaza fracciones de centavo en vez de redondearlas', () => {
    expect(probar(1000.005)).toBe(false);
    expect(probar(0.001)).toBe(false);
    expect(probar(10.123)).toBe(false);
  });
});
