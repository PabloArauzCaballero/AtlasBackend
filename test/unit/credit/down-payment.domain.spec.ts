/**
 * @file Verifica el cálculo del pago inicial en el servidor (APP-04).
 * @business El cliente no puede declarar el importe del pago inicial: sale de la compra (60/40 sobre el financiado).
 * @system Ejercita `domain/down-payment.ts` (funciones puras, centavos enteros) contra el desglose de la app.
 */
import { describe, expect, it } from '@jest/globals';
import {
  checkDownPaymentAmount,
  expectedDownPaymentAmount,
  expectedDownPaymentCents,
  fromCents,
  toCents,
} from '../../../src/modules/credit/domain/down-payment.js';

/** El desglose de la app (`apps/consumer-app/src/domain/policy.ts`): inicial = round(precio × 0,6), financiado = resto. */
const desgloseDeLaApp = (precioCents: number) => {
  const inicial = Math.round(precioCents * 0.6);
  return { inicial, financiado: precioCents - inicial };
};

describe('down-payment', () => {
  it('toCents / fromCents: importes de la API ida y vuelta, sin flotantes', () => {
    expect(toCents('720.00')).toBe(72_000);
    expect(toCents('720.5')).toBe(72_050);
    expect(toCents('720')).toBe(72_000);
    expect(toCents(720.1)).toBe(72_010);
    expect(toCents('-1')).toBeNull();
    expect(toCents('1.234')).toBeNull();
    expect(toCents('abc')).toBeNull();
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(fromCents(72_005)).toBe('720.05');
    expect(fromCents(5)).toBe('0.05');
  });

  it('el caso de TEST: Bs 480 financiados son Bs 720 de inicial (compra de Bs 1.200)', () => {
    expect(expectedDownPaymentAmount('480.00')).toBe('720.00');
  });

  it('cuadra con el desglose de la app para todo precio de Bs 100 a Bs 150 céntimo a céntimo', () => {
    for (let precio = 10_000; precio <= 15_000; precio += 1) {
      const { inicial, financiado } = desgloseDeLaApp(precio);
      expect(expectedDownPaymentCents(financiado)).toContain(inicial);
      expect(checkDownPaymentAmount(fromCents(inicial), fromCents(financiado)).ok).toBe(true);
    }
  });

  it('por el redondeo, un financiado admite varios iniciales a un centavo: se aceptan esos y nada más', () => {
    // 48.000 céntimos financiados salen de precios 119.999, 120.000 y 120.001: iniciales 71.999, 72.000 y 72.001.
    expect(expectedDownPaymentCents(48_000)).toEqual([71_999, 72_000, 72_001]);
    for (let financiado = 1; financiado <= 20_000; financiado += 1) {
      const admitidos = expectedDownPaymentCents(financiado);
      const ideal = financiado * 1.5;
      for (const inicial of admitidos) expect(Math.abs(inicial - ideal)).toBeLessThanOrEqual(1.5);
    }
  });

  it('el que se muestra es el más cercano a 1,5 × financiado', () => {
    expect(expectedDownPaymentAmount('480.00')).toBe('720.00');
    expect(expectedDownPaymentAmount(100)).toBe('150.00');
  });

  it('sin financiado positivo no hay inicial', () => {
    expect(expectedDownPaymentCents(0)).toEqual([]);
    expect(expectedDownPaymentCents(-5)).toEqual([]);
    expect(expectedDownPaymentCents(1.5)).toEqual([]);
    expect(expectedDownPaymentAmount(null)).toBeNull();
    expect(expectedDownPaymentAmount('0')).toBeNull();
  });

  it('checkDownPaymentAmount dice por qué no', () => {
    expect(checkDownPaymentAmount('1.00', '480.00')).toMatchObject({
      ok: false,
      code: 'DOWN_PAYMENT_AMOUNT_MISMATCH',
      expectedCents: [71_999, 72_000, 72_001],
    });
    expect(checkDownPaymentAmount('0', '480.00')).toMatchObject({ ok: false, code: 'DOWN_PAYMENT_AMOUNT_INVALID' });
    expect(checkDownPaymentAmount('x', '480.00')).toMatchObject({ ok: false, code: 'DOWN_PAYMENT_AMOUNT_INVALID' });
    expect(checkDownPaymentAmount('720.00', '0')).toMatchObject({ ok: false, code: 'DOWN_PAYMENT_EXPECTED_UNKNOWN' });
    expect(checkDownPaymentAmount(720, 480)).toMatchObject({ ok: true, amountCents: 72_000 });
    expect(checkDownPaymentAmount('720.02', '480.00')).toMatchObject({ ok: false, code: 'DOWN_PAYMENT_AMOUNT_MISMATCH' });
  });
});
