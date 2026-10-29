import { fitToColumn } from '../../../src/modules/partner-onboarding/application/column-fit.js';

describe('fitToColumn', () => {
  it('devuelve null para null y undefined', () => {
    expect(fitToColumn(null, 10)).toBeNull();
    expect(fitToColumn(undefined, 10)).toBeNull();
  });

  it('no toca un texto que cabe, incluido el vacío y el justo en el límite', () => {
    expect(fitToColumn('', 5)).toBe('');
    expect(fitToColumn('12345', 5)).toBe('12345');
  });

  it('recorta con puntos suspensivos y respeta el máximo (límite + 1)', () => {
    const r = fitToColumn('123456', 5);
    expect(r).toBe('1234…');
    expect(Array.from(r ?? '').length).toBe(5);
  });

  it('un comentario de 300 caracteres cabe en VARCHAR(120)', () => {
    const r = fitToColumn('x'.repeat(300), 120) ?? '';
    expect(Array.from(r).length).toBeLessThanOrEqual(120);
    expect(r.endsWith('…')).toBe(true);
  });

  it('no parte un par sustituto (emoji) a la mitad', () => {
    const r = fitToColumn('😀'.repeat(10), 4) ?? '';
    expect(Array.from(r).length).toBe(4);
    expect(r).toBe('😀😀😀…');
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(r)).toBe(false);
  });

  it('quita el espacio que quedaría pegado a los puntos suspensivos', () => {
    expect(fitToColumn('abcd efgh', 6)).toBe('abcd…');
  });
});
