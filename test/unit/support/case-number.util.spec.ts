import { describe, expect, it } from '@jest/globals';
import { generateCaseNumber, generateChannelCode, isCaseNumber } from '../../../src/modules/support/domain/case-number.util.js';

/**
 * El número que una persona dicta por teléfono. Es aleatorio a propósito: un correlativo cuenta
 * cuántos casos lleva la empresa y a qué ritmo crecen sus reclamos.
 */
describe('número de caso', () => {
  it('tiene el formato ATL-SUP-<año>-<8 dígitos>', () => {
    const number = generateCaseNumber(new Date('2026-08-27T00:00:00.000Z'));
    expect(number).toMatch(/^ATL-SUP-2026-\d{8}$/);
    expect(isCaseNumber(number)).toBe(true);
  });

  it('no es correlativo: dos números seguidos no se parecen', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateCaseNumber()));
    // Con mil millones de combinaciones, 200 sorteos sin repetición es lo esperable.
    expect(generated.size).toBe(200);
  });

  it('rechaza lo que no tiene el formato', () => {
    expect(isCaseNumber('ATL-SUP-2026-123')).toBe(false);
    expect(isCaseNumber('12345')).toBe(false);
  });

  it('el código de canal sigue el mismo criterio', () => {
    expect(generateChannelCode(new Date('2026-08-27T00:00:00.000Z'))).toMatch(/^ATL-CH-2026-\d{8}$/);
  });
});
