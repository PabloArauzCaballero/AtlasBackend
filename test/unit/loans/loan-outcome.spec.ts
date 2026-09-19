import { bucketForDaysPastDue, daysBetween, loanDaysPastDue } from '../../../src/modules/loans/domain/loan-delinquency.js';
import { amountForLabel, labelForLoan, windowIsMature, worstDaysPastDue } from '../../../src/modules/loans/domain/loan-outcome.js';

describe('daysBetween', () => {
  it('cuenta días de calendario, no fracciones de milisegundos', () => {
    // Vencía ayer a las 00:00; son las 08:00 de hoy. Es 1 día de atraso, no 0.
    expect(daysBetween('2026-08-10', new Date('2026-08-11T08:00:00Z'))).toBe(1);
    expect(daysBetween('2026-08-11', new Date('2026-08-11T23:59:00Z'))).toBe(0);
    expect(daysBetween('2026-08-12', new Date('2026-08-11T00:00:00Z'))).toBe(-1);
  });

  it('rechaza una fecha ilegible en vez de devolver NaN', () => {
    expect(() => daysBetween('no-es-fecha', new Date())).toThrow();
  });
});

describe('loanDaysPastDue', () => {
  const asOf = new Date('2026-08-11T00:00:00Z');

  it('toma la cuota impaga MÁS ANTIGUA, no la última', () => {
    const days = loanDaysPastDue(
      [
        { dueDate: '2026-05-13', outstandingCents: 5_000 },
        { dueDate: '2026-08-01', outstandingCents: 5_000 },
      ],
      asOf,
    );
    expect(days).toBe(90);
  });

  it('no cuenta las cuotas ya saldadas', () => {
    expect(loanDaysPastDue([{ dueDate: '2026-01-01', outstandingCents: 0 }], asOf)).toBe(0);
  });

  it('no cuenta como atraso una cuota que aún no vence', () => {
    expect(loanDaysPastDue([{ dueDate: '2026-12-01', outstandingCents: 5_000 }], asOf)).toBe(0);
  });
});

describe('bucketForDaysPastDue', () => {
  it('asigna el tramo por los cortes estándar', () => {
    expect(bucketForDaysPastDue(0)).toBe('current');
    expect(bucketForDaysPastDue(1)).toBe('dpd_1_29');
    expect(bucketForDaysPastDue(29)).toBe('dpd_1_29');
    expect(bucketForDaysPastDue(30)).toBe('dpd_30_59');
    expect(bucketForDaysPastDue(59)).toBe('dpd_30_59');
    expect(bucketForDaysPastDue(60)).toBe('dpd_60_89');
    expect(bucketForDaysPastDue(89)).toBe('dpd_60_89');
    expect(bucketForDaysPastDue(90)).toBe('dpd_90_plus');
    expect(bucketForDaysPastDue(400)).toBe('dpd_90_plus');
  });
});

describe('worstDaysPastDue', () => {
  const asOf = new Date('2026-08-11T00:00:00Z');

  it('recuerda el atraso con el que se pagó una cuota ya saldada', () => {
    // Pagó todo, pero con 120 días de retraso. Mirar sólo el estado presente lo blanquearía.
    const worst = worstDaysPastDue({
      installments: [{ dueDate: '2026-01-01', settledAt: new Date('2026-05-01T00:00:00Z'), outstandingCents: 0 }],
      writtenOffAt: null,
      asOf,
    });
    expect(worst).toBe(120);
  });

  it('mide contra el corte cuando la cuota sigue abierta', () => {
    const worst = worstDaysPastDue({
      installments: [{ dueDate: '2026-07-12', settledAt: null, outstandingCents: 5_000 }],
      writtenOffAt: null,
      asOf,
    });
    expect(worst).toBe(30);
  });

  it('ignora un pago posterior al corte de la ventana', () => {
    // Se pagó después de que la ventana cerrara: dentro de la ventana seguía impaga.
    const worst = worstDaysPastDue({
      installments: [{ dueDate: '2026-07-12', settledAt: new Date('2026-10-01T00:00:00Z'), outstandingCents: 0 }],
      writtenOffAt: null,
      asOf,
    });
    expect(worst).toBe(30);
  });
});

describe('labelForLoan', () => {
  const asOf = new Date('2026-08-11T00:00:00Z');
  const base = { writtenOffAt: null, asOf };

  it('marca BAD el préstamo castigado', () => {
    expect(
      labelForLoan({
        ...base,
        writtenOffAt: new Date('2026-08-01T00:00:00Z'),
        installments: [{ dueDate: '2026-08-10', settledAt: null, outstandingCents: 100 }],
      }),
    ).toBe('BAD');
  });

  it('marca BAD a partir de 90 días de atraso', () => {
    expect(labelForLoan({ ...base, installments: [{ dueDate: '2026-05-13', settledAt: null, outstandingCents: 100 }] })).toBe('BAD');
  });

  it('marca INDETERMINATE la zona gris de 30 a 89 días', () => {
    expect(labelForLoan({ ...base, installments: [{ dueDate: '2026-07-12', settledAt: null, outstandingCents: 100 }] })).toBe(
      'INDETERMINATE',
    );
    expect(labelForLoan({ ...base, installments: [{ dueDate: '2026-05-14', settledAt: null, outstandingCents: 100 }] })).toBe(
      'INDETERMINATE',
    );
  });

  it('marca GOOD por debajo de 30 días', () => {
    expect(labelForLoan({ ...base, installments: [{ dueDate: '2026-08-01', settledAt: null, outstandingCents: 100 }] })).toBe('GOOD');
    expect(labelForLoan({ ...base, installments: [] })).toBe('GOOD');
  });

  it('no blanquea a quien pagó tardísimo', () => {
    expect(
      labelForLoan({
        ...base,
        installments: [{ dueDate: '2026-01-01', settledAt: new Date('2026-06-01T00:00:00Z'), outstandingCents: 0 }],
      }),
    ).toBe('BAD');
  });
});

describe('amountForLabel', () => {
  const input = {
    installments: [{ dueDate: '2026-05-13', settledAt: null, outstandingCents: 100 }],
    writtenOffAt: null,
    asOf: new Date('2026-08-11T00:00:00Z'),
  };

  it('en un malo manda el capital expuesto, en unidades de moneda', () => {
    expect(amountForLabel('BAD', input, 125_000)).toBe(1_250);
  });

  it('en el resto manda los días de atraso', () => {
    expect(amountForLabel('INDETERMINATE', input, 125_000)).toBe(90);
  });
});

describe('windowIsMature', () => {
  const decisionAt = new Date('2026-05-01T00:00:00Z');

  it('no da por cumplida una ventana antes de tiempo', () => {
    expect(windowIsMature(decisionAt, 90, new Date('2026-07-29T00:00:00Z'))).toBe(false);
  });

  it('la da por cumplida al llegar el día', () => {
    expect(windowIsMature(decisionAt, 90, new Date('2026-07-30T00:00:00Z'))).toBe(true);
    expect(windowIsMature(decisionAt, 30, new Date('2026-06-01T00:00:00Z'))).toBe(true);
  });
});
