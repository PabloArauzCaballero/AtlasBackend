import { describe, expect, it } from '@jest/globals';
import {
  MONTHLY_INCOME_ATTRIBUTE,
  evaluateProductEligibility,
  meetsProductRequirements,
  qualifiesForProduct,
} from '../../../src/modules/credit/application/credit-product-eligibility.js';

/**
 * Elegibilidad POR PRODUCTO.
 *
 * Es una capa distinta de la habilitación general: un cliente habilitado puede no alcanzar el
 * ingreso mínimo de un producto y sí el de otro. `min_monthly_income` estaba declarado en
 * `credit_products` desde que se creó la tabla y no lo evaluaba nadie.
 */
const PRODUCT = {
  productCode: 'consumo_12',
  currencyCode: 'BOB',
  minAmount: '1000.00',
  maxAmount: '20000.00',
  minTermMonths: 3,
  maxTermMonths: 24,
  minMonthlyIncome: null as string | null,
};

const OK_TERMS = { requestedAmount: 5000, requestedTermMonths: 12 };

describe('evaluateProductEligibility', () => {
  it('sin bloqueadores cuando el monto y el plazo caen dentro del rango y el producto no exige ingreso', () => {
    expect(evaluateProductEligibility(PRODUCT, OK_TERMS, {})).toEqual([]);
    expect(meetsProductRequirements(PRODUCT, OK_TERMS, {})).toBe(true);
  });

  it('rechaza el monto fuera de rango indicando cuál es el rango válido', () => {
    const below = evaluateProductEligibility(PRODUCT, { ...OK_TERMS, requestedAmount: 500 }, {});
    expect(below).toEqual([{ code: 'REQUESTED_AMOUNT_OUT_OF_RANGE', detail: '1000.00-20000.00' }]);

    const above = evaluateProductEligibility(PRODUCT, { ...OK_TERMS, requestedAmount: 30_000 }, {});
    expect(above[0].code).toBe('REQUESTED_AMOUNT_OUT_OF_RANGE');
  });

  it('rechaza el plazo fuera de rango indicando cuál es el rango válido', () => {
    expect(evaluateProductEligibility(PRODUCT, { ...OK_TERMS, requestedTermMonths: 36 }, {})).toEqual([
      { code: 'REQUESTED_TERM_OUT_OF_RANGE', detail: '3-24' },
    ]);
  });

  /** Igual criterio que la regla de habilitación: el frontend necesita la lista completa. */
  it('acumula todos los bloqueadores en vez de cortar en el primero', () => {
    const product = { ...PRODUCT, minMonthlyIncome: '9000.00' };
    const blockers = evaluateProductEligibility(
      product,
      { requestedAmount: 50, requestedTermMonths: 99 },
      { [MONTHLY_INCOME_ATTRIBUTE]: 3000 },
    );
    expect(blockers.map((blocker) => blocker.code)).toEqual([
      'REQUESTED_AMOUNT_OUT_OF_RANGE',
      'REQUESTED_TERM_OUT_OF_RANGE',
      'INSUFFICIENT_DECLARED_INCOME',
    ]);
  });

  describe('ingreso mínimo declarado', () => {
    const withIncome = { ...PRODUCT, minMonthlyIncome: '5000.00' };

    it('acepta cuando el ingreso declarado alcanza o supera el umbral', () => {
      expect(evaluateProductEligibility(withIncome, OK_TERMS, { [MONTHLY_INCOME_ATTRIBUTE]: 5000 })).toEqual([]);
      expect(evaluateProductEligibility(withIncome, OK_TERMS, { [MONTHLY_INCOME_ATTRIBUTE]: 12_000 })).toEqual([]);
    });

    it('rechaza cuando el ingreso declarado no alcanza, informando el umbral', () => {
      expect(evaluateProductEligibility(withIncome, OK_TERMS, { [MONTHLY_INCOME_ATTRIBUTE]: 4999 })).toEqual([
        { code: 'INSUFFICIENT_DECLARED_INCOME', detail: 'required=5000.00' },
      ]);
    });

    /** Sin ingreso declarado no hay con qué comparar: no puede aprobarse "por defecto". */
    it('rechaza cuando el producto exige ingreso y el cliente no declaró ninguno', () => {
      expect(evaluateProductEligibility(withIncome, OK_TERMS, {})).toEqual([
        { code: 'DECLARED_INCOME_MISSING', detail: MONTHLY_INCOME_ATTRIBUTE },
      ]);
      expect(evaluateProductEligibility(withIncome, OK_TERMS, { [MONTHLY_INCOME_ATTRIBUTE]: Number.NaN })[0].code).toBe(
        'DECLARED_INCOME_MISSING',
      );
    });

    /** La ausencia de requisito no es un requisito de cero. */
    it('un producto sin umbral no exige ingreso, aunque el cliente no declare nada', () => {
      expect(evaluateProductEligibility(PRODUCT, OK_TERMS, {})).toEqual([]);
    });
  });
});

describe('qualifiesForProduct', () => {
  /**
   * Al listar el catálogo todavía no hay términos: interesa si el producto es ofrecible, no si un
   * monto concreto encaja. Se evalúa con la petición más favorable posible para el cliente.
   */
  it('evalúa con el monto y el plazo mínimos del producto', () => {
    expect(qualifiesForProduct(PRODUCT, {})).toBe(true);
    expect(qualifiesForProduct({ ...PRODUCT, minMonthlyIncome: '8000.00' }, { [MONTHLY_INCOME_ATTRIBUTE]: 9000 })).toBe(true);
    expect(qualifiesForProduct({ ...PRODUCT, minMonthlyIncome: '8000.00' }, { [MONTHLY_INCOME_ATTRIBUTE]: 2000 })).toBe(false);
  });
});
