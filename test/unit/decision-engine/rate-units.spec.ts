import { describe, expect, it } from '@jest/globals';
import { percentToUnitRate, unitRateToPercent } from '../../../src/modules/decision-engine/rate-units.js';

/**
 * Prueba de CONTRATO, no de implementación: fija 18 ↔ 0,18 en los dos sentidos. Si algún día se
 * "simplifica" a multiplicar por 0.01 con una constante distinta, o se invierte el sentido de una
 * de las dos funciones, esta prueba lo rompe antes de que lo note el motor con un 400.
 */
describe('rate-units · la frontera de unidades con el motor', () => {
  it('18 % del libro es 0,18 tanto por uno para el motor', () => {
    expect(percentToUnitRate(18)).toBe(0.18);
  });

  it('0,18 tanto por uno del motor es 18 % en el libro', () => {
    expect(unitRateToPercent(0.18)).toBe(18);
  });

  it('las dos son inversas entre sí', () => {
    for (const percent of [0, 4, 18, 22, 24, 99.99]) {
      expect(unitRateToPercent(percentToUnitRate(percent))).toBeCloseTo(percent, 10);
    }
  });

  it('un 18 sin convertir NUNCA pasaría por tanto por uno: se ve a simple vista', () => {
    // Documenta la magnitud del defecto que corrige T-3: un 18 mandado tal cual multiplicaría por
    // cien cualquier cálculo que lo tome como tanto por uno.
    expect(percentToUnitRate(18)).not.toBe(18);
  });
});
