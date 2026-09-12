import { addMonthsClamped, buildSchedule, toDateOnly } from '../../../src/modules/loans/domain/loan-schedule.js';
import { fromCents, roundCents, toCents } from '../../../src/modules/loans/domain/money.util.js';

describe('money.util', () => {
  it('convierte texto decimal a céntimos sin pasar por coma flotante', () => {
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents('0.10')).toBe(10);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('5')).toBe(500);
    expect(toCents('-3.07')).toBe(-307);
    expect(toCents(null)).toBe(0);
  });

  it('no pierde el céntimo que la coma flotante se comería', () => {
    // 0.1 + 0.2 !== 0.3 en binario. En céntimos enteros no hay nada que discutir.
    expect(toCents('0.1') + toCents('0.2')).toBe(toCents('0.3'));
  });

  it('vuelve al texto que espera NUMERIC(18,2)', () => {
    expect(fromCents(123456)).toBe('1234.56');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(0)).toBe('0.00');
    expect(fromCents(-307)).toBe('-3.07');
  });

  it('redondea el medio hacia arriba también en negativo, para que reversar sea simétrico', () => {
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
    expect(roundCents(-2.4)).toBe(-2);
  });
});

describe('addMonthsClamped', () => {
  it('cae al último día del mes destino cuando el día no existe', () => {
    expect(toDateOnly(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28');
    expect(toDateOnly(addMonthsClamped(new Date('2024-01-31T00:00:00Z'), 1))).toBe('2024-02-29');
    expect(toDateOnly(addMonthsClamped(new Date('2026-03-31T00:00:00Z'), 1))).toBe('2026-04-30');
  });

  it('conserva el día cuando sí existe, y cruza el año', () => {
    expect(toDateOnly(addMonthsClamped(new Date('2026-01-15T00:00:00Z'), 1))).toBe('2026-02-15');
    expect(toDateOnly(addMonthsClamped(new Date('2026-11-15T00:00:00Z'), 3))).toBe('2027-02-15');
  });
});

describe('buildSchedule', () => {
  const firstDueDate = new Date('2026-09-15T00:00:00Z');

  it('reparte el capital exacto con tasa cero', () => {
    const schedule = buildSchedule({
      principalCents: 100_000,
      annualInterestRatePercent: 0,
      termMonths: 3,
      firstDueDate,
    });
    expect(schedule).toHaveLength(3);
    expect(schedule.map((entry) => entry.principalCents)).toEqual([33_333, 33_333, 33_334]);
    expect(schedule.every((entry) => entry.interestCents === 0)).toBe(true);
  });

  it('cierra el residuo del redondeo en la última cuota', () => {
    // 1.000,00 en 7 cuotas al 24 % anual: ninguna división cae exacta.
    const schedule = buildSchedule({
      principalCents: 100_000,
      annualInterestRatePercent: 24,
      termMonths: 7,
      firstDueDate,
    });
    const totalPrincipal = schedule.reduce((sum, entry) => sum + entry.principalCents, 0);
    expect(totalPrincipal).toBe(100_000);
  });

  it('mantiene la identidad capital = suma de capitales en un barrido de casos', () => {
    for (const principal of [1, 99, 100, 12_345, 1_000_000]) {
      for (const rate of [0, 0.5, 12, 24, 96]) {
        for (const term of [1, 2, 3, 6, 12, 24, 36]) {
          const schedule = buildSchedule({
            principalCents: principal,
            annualInterestRatePercent: rate,
            termMonths: term,
            firstDueDate,
          });
          const sum = schedule.reduce((total, entry) => total + entry.principalCents, 0);
          expect(sum).toBe(principal);
          expect(schedule.every((entry) => entry.principalCents >= 0)).toBe(true);
          expect(schedule.every((entry) => entry.interestCents >= 0)).toBe(true);
        }
      }
    }
  });

  it('numera y fecha las cuotas mes a mes desde el primer vencimiento', () => {
    const schedule = buildSchedule({
      principalCents: 60_000,
      annualInterestRatePercent: 12,
      termMonths: 3,
      firstDueDate: new Date('2026-01-31T00:00:00Z'),
    });
    expect(schedule.map((entry) => entry.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(schedule.map((entry) => entry.installmentNumber)).toEqual([1, 2, 3]);
  });

  it('cobra interés decreciente sobre el saldo, no plano sobre el capital', () => {
    const schedule = buildSchedule({
      principalCents: 100_000,
      annualInterestRatePercent: 24,
      termMonths: 6,
      firstDueDate,
    });
    const interests = schedule.map((entry) => entry.interestCents);
    expect(interests[0]).toBe(2_000); // 1 000,00 × 2 % mensual
    for (let index = 1; index < interests.length; index += 1) {
      expect(interests[index]).toBeLessThan(interests[index - 1]);
    }
  });

  it('rechaza entradas imposibles en vez de producir un cronograma absurdo', () => {
    expect(() => buildSchedule({ principalCents: 0, annualInterestRatePercent: 12, termMonths: 6, firstDueDate })).toThrow();
    expect(() => buildSchedule({ principalCents: 1_000, annualInterestRatePercent: 12, termMonths: 0, firstDueDate })).toThrow();
  });
});
