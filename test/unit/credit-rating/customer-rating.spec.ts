import { rateCustomer, type RatedDebt } from '../../../src/modules/credit-rating/domain/customer-rating.js';
import type { RatingBand } from '../../../src/modules/credit-rating/domain/rating-scale.js';

const BAND_A: RatingBand = { grade: 'A', gradeLabel: 'Normal', severityRank: 0, minDaysPastDue: 0, maxDaysPastDue: 0, provisionRate: 0.01 };
const BAND_C: RatingBand = {
  grade: 'C',
  gradeLabel: 'Deficiente',
  severityRank: 2,
  minDaysPastDue: 31,
  maxDaysPastDue: 60,
  provisionRate: 0.2,
};
const BAND_F: RatingBand = {
  grade: 'F',
  gradeLabel: 'Pérdida irrecuperable',
  severityRank: 5,
  minDaysPastDue: 181,
  maxDaysPastDue: null,
  provisionRate: 1,
};

function debt(loanId: string, band: RatingBand, exposureCents: number, daysPastDue = 0): RatedDebt {
  return {
    loanId,
    rating: {
      band,
      daysPastDue,
      exposureCents,
      provisionCents: Math.round(exposureCents * band.provisionRate),
      reason: 'days_past_due',
    },
  };
}

describe('rateCustomer con arrastre', () => {
  it('hereda la PEOR categoría, no el promedio', () => {
    // Nueve créditos pequeños al día y uno grande en pérdida. Un promedio lo dejaría en categoría
    // buena y se le volvería a prestar; lo que ocurrió es que dejó de pagar.
    const debts = [
      ...Array.from({ length: 9 }, (_unused, index) => debt(`${index + 1}`, BAND_A, 10_000)),
      debt('10', BAND_F, 500_000, 400),
    ];

    const rating = rateCustomer({ debts, bestBand: BAND_A, applyContamination: true });

    expect(rating.band.grade).toBe('F');
    expect(rating.drivingLoanId).toBe('10');
    expect(rating.reason).toBe('worst_operation');
  });

  it('suma exposición y previsión de TODAS las operaciones, no sólo la peor', () => {
    const rating = rateCustomer({
      debts: [debt('1', BAND_A, 100_000), debt('2', BAND_C, 300_000, 45)],
      bestBand: BAND_A,
      applyContamination: true,
    });

    expect(rating.totalExposureCents).toBe(400_000);
    expect(rating.totalProvisionCents).toBe(1_000 + 60_000);
    expect(rating.ratedLoanCount).toBe(2);
  });

  it('reporta el PEOR atraso entre sus operaciones', () => {
    const rating = rateCustomer({
      debts: [debt('1', BAND_C, 100_000, 45), debt('2', BAND_A, 100_000, 0)],
      bestBand: BAND_A,
      applyContamination: true,
    });
    expect(rating.worstDaysPastDue).toBe(45);
  });

  it('ante empate de categoría, arrastra el de MAYOR exposición', () => {
    // El desempate tiene que ser explícito: si dependiera del orden de las filas, el mismo cliente
    // daría dos causas distintas en dos consultas iguales.
    const rating = rateCustomer({
      debts: [debt('1', BAND_C, 100_000, 45), debt('2', BAND_C, 900_000, 45)],
      bestBand: BAND_A,
      applyContamination: true,
    });
    expect(rating.drivingLoanId).toBe('2');
  });

  it('no deja al cliente sin deuda viva sin calificación: cae en la mejor banda', () => {
    const rating = rateCustomer({ debts: [], bestBand: BAND_A, applyContamination: true });

    expect(rating.band.grade).toBe('A');
    expect(rating.reason).toBe('no_open_debt');
    expect(rating.drivingLoanId).toBeNull();
    expect(rating.totalExposureCents).toBe(0);
    expect(rating.ratedLoanCount).toBe(0);
  });
});

describe('rateCustomer sin arrastre', () => {
  it('califica por la operación de MAYOR exposición y no por la peor', () => {
    const rating = rateCustomer({
      debts: [debt('1', BAND_A, 900_000), debt('2', BAND_F, 10_000, 400)],
      bestBand: BAND_A,
      applyContamination: false,
    });

    expect(rating.band.grade).toBe('A');
    expect(rating.drivingLoanId).toBe('1');
    // El peor atraso se sigue reportando: la categoría cambia de criterio, el hecho observado no.
    expect(rating.worstDaysPastDue).toBe(400);
  });
});
