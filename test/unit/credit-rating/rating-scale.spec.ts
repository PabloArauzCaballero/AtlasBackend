import {
  bandForDaysPastDue,
  normalizeScale,
  provisionCentsFor,
  rateLoan,
  worstBand,
  type RatingBand,
} from '../../../src/modules/credit-rating/domain/rating-scale.js';

/** La escala A–F sembrada como política de plataforma. Es la que califica en producción. */
const ASFI: RatingBand[] = [
  { grade: 'A', gradeLabel: 'Normal', severityRank: 0, minDaysPastDue: 0, maxDaysPastDue: 0, provisionRate: 0.01 },
  { grade: 'B', gradeLabel: 'Riesgo potencial', severityRank: 1, minDaysPastDue: 1, maxDaysPastDue: 30, provisionRate: 0.05 },
  { grade: 'C', gradeLabel: 'Deficiente', severityRank: 2, minDaysPastDue: 31, maxDaysPastDue: 60, provisionRate: 0.2 },
  { grade: 'D', gradeLabel: 'Dudoso', severityRank: 3, minDaysPastDue: 61, maxDaysPastDue: 90, provisionRate: 0.5 },
  { grade: 'E', gradeLabel: 'Pérdida', severityRank: 4, minDaysPastDue: 91, maxDaysPastDue: 180, provisionRate: 0.8 },
  { grade: 'F', gradeLabel: 'Pérdida irrecuperable', severityRank: 5, minDaysPastDue: 181, maxDaysPastDue: null, provisionRate: 1 },
];

describe('normalizeScale', () => {
  it('acepta la escala A–F completa', () => {
    expect(normalizeScale(ASFI).map((band) => band.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('ordena por severidad aunque lleguen desordenadas de la base', () => {
    const shuffled = [ASFI[3], ASFI[0], ASFI[5], ASFI[1], ASFI[4], ASFI[2]];
    expect(normalizeScale(shuffled).map((band) => band.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('rechaza un HUECO en la escala en vez de calificar mal en silencio', () => {
    // De 30 salta a 61: nadie cubre los días 31–60, y un crédito con 45 días caería donde toque.
    const withGap = ASFI.filter((band) => band.grade !== 'C');
    expect(() => normalizeScale(withGap)).toThrow(/hueco o un solape/);
  });

  it('rechaza un SOLAPE entre bandas', () => {
    const overlapping = ASFI.map((band) => (band.grade === 'C' ? { ...band, minDaysPastDue: 20 } : band));
    expect(() => normalizeScale(overlapping)).toThrow(/hueco o un solape/);
  });

  it('exige que la escala empiece en 0 días', () => {
    const shifted = ASFI.map((band) => (band.grade === 'A' ? { ...band, minDaysPastDue: 1 } : band));
    expect(() => normalizeScale(shifted)).toThrow(/empezar en 0/);
  });

  it('exige que la última banda sea abierta: si no, nadie cubre el atraso extremo', () => {
    const capped = ASFI.map((band) => (band.grade === 'F' ? { ...band, maxDaysPastDue: 365 } : band));
    expect(() => normalizeScale(capped)).toThrow(/abierta/);
  });

  it('rechaza una escala vacía', () => {
    expect(() => normalizeScale([])).toThrow(/no tiene bandas/);
  });
});

describe('bandForDaysPastDue', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [30, 'B'],
    [31, 'C'],
    [60, 'C'],
    [61, 'D'],
    [90, 'D'],
    [91, 'E'],
    [180, 'E'],
    [181, 'F'],
    [3_650, 'F'],
  ])('con %i días de atraso califica %s', (days, grade) => {
    expect(bandForDaysPastDue(ASFI, days).grade).toBe(grade);
  });

  it('trata el atraso negativo como al día: pagar antes no mejora la categoría', () => {
    expect(bandForDaysPastDue(ASFI, -10).grade).toBe('A');
  });
});

describe('provisionCentsFor', () => {
  it('calcula la previsión sobre céntimos enteros', () => {
    expect(provisionCentsFor(300_000, 0.2)).toBe(60_000);
  });

  it('redondea al céntimo y no arrastra el error del flotante', () => {
    // 0.1 + 0.2 !== 0.3: el cálculo entra por enteros justamente para que esto no ocurra.
    expect(provisionCentsFor(333_333, 0.2)).toBe(66_667);
  });

  it('sin exposición no hay previsión, aunque la tasa sea del 100 %', () => {
    expect(provisionCentsFor(0, 1)).toBe(0);
    expect(provisionCentsFor(-500, 1)).toBe(0);
  });
});

describe('rateLoan', () => {
  it('califica por días de atraso y congela la previsión del momento', () => {
    const rating = rateLoan(ASFI, { daysPastDue: 45, exposureCents: 300_000, writtenOff: false });
    expect(rating.band.grade).toBe('C');
    expect(rating.provisionCents).toBe(60_000);
    expect(rating.reason).toBe('days_past_due');
  });

  it('manda el castigo sobre el atraso: un crédito castigado va a la peor banda', () => {
    // 5 días de atraso serían B. Castigado, es F al 100 %: el saldo ya salió del libro.
    const rating = rateLoan(ASFI, { daysPastDue: 5, exposureCents: 250_000, writtenOff: true });
    expect(rating.band.grade).toBe('F');
    expect(rating.provisionCents).toBe(250_000);
    expect(rating.reason).toBe('written_off');
  });

  it('normaliza exposición y atraso negativos en vez de propagarlos', () => {
    const rating = rateLoan(ASFI, { daysPastDue: -3, exposureCents: -100, writtenOff: false });
    expect(rating.band.grade).toBe('A');
    expect(rating.exposureCents).toBe(0);
    expect(rating.provisionCents).toBe(0);
  });
});

describe('worstBand', () => {
  it('es la de mayor severidad, no la última del array', () => {
    const shuffled = [ASFI[3], ASFI[0], ASFI[5], ASFI[1], ASFI[4], ASFI[2]];
    expect(worstBand(shuffled).grade).toBe('F');
  });

  it('valida la escala antes de responder: una escala rota no tiene "peor banda"', () => {
    expect(() => worstBand([ASFI[0], ASFI[2], ASFI[5]])).toThrow(/hueco o un solape/);
  });
});
