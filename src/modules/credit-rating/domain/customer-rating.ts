/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza califica al cliente por el peor de sus créditos, no por el promedio.
 * @system agrega calificaciones de deuda en una del cliente aplicando arrastre, sin base ni reloj.
 */
import type { LoanRating, RatingBand } from './rating-scale.js';

/** Una deuda ya calificada, con la identidad que permite decir cuál arrastró al cliente. */
export type RatedDebt = {
  loanId: string;
  rating: LoanRating;
};

export type CustomerRating = {
  band: RatingBand;
  worstDaysPastDue: number;
  ratedLoanCount: number;
  totalExposureCents: number;
  totalProvisionCents: number;
  /** El crédito que fijó la categoría. Sin él, «por qué me bajaron» no tiene respuesta. */
  drivingLoanId: string | null;
  reason: 'worst_operation' | 'no_open_debt';
};

/**
 * Califica al CLIENTE a partir de sus deudas calificadas.
 *
 * La regla es de arrastre (contaminación): el cliente toma la PEOR categoría de sus operaciones, no
 * el promedio ni la ponderada por saldo. La razón no es normativa sino aritmética: un cliente con
 * nueve créditos pequeños al día y uno grande en pérdida promedia «bueno», y ese promedio describe a
 * un cliente que no existe. Lo que ocurrió es que dejó de pagar, y esa es la señal que sirve para
 * decidir si se le vuelve a prestar.
 *
 * `applyContamination = false` es la excepción explícita para carteras que califican operación por
 * operación. Se pasa desde la política versionada y queda escrita en la fila, porque un cliente
 * calificado sin arrastre y otro con arrastre no son comparables y hay que poder distinguirlos.
 *
 * Sin deudas vivas el cliente NO se queda sin calificación: cae en la mejor banda con
 * `reason = 'no_open_debt'`. Devolver `null` obligaría a cada consumidor a inventar qué hacer con
 * ese hueco, y el que lo inventara como «sin datos = riesgoso» castigaría a quien acaba de pagar.
 */
export function rateCustomer(input: { debts: readonly RatedDebt[]; bestBand: RatingBand; applyContamination: boolean }): CustomerRating {
  const totals = input.debts.reduce(
    (accumulator, debt) => ({
      exposure: accumulator.exposure + debt.rating.exposureCents,
      provision: accumulator.provision + debt.rating.provisionCents,
    }),
    { exposure: 0, provision: 0 },
  );

  if (input.debts.length === 0) {
    return {
      band: input.bestBand,
      worstDaysPastDue: 0,
      ratedLoanCount: 0,
      totalExposureCents: 0,
      totalProvisionCents: 0,
      drivingLoanId: null,
      reason: 'no_open_debt',
    };
  }

  const driver = input.applyContamination ? worstDebt(input.debts) : largestDebt(input.debts);

  return {
    band: driver.rating.band,
    worstDaysPastDue: input.debts.reduce((worst, debt) => Math.max(worst, debt.rating.daysPastDue), 0),
    ratedLoanCount: input.debts.length,
    totalExposureCents: totals.exposure,
    totalProvisionCents: totals.provision,
    drivingLoanId: driver.loanId,
    reason: 'worst_operation',
  };
}

/**
 * La peor deuda. Ante empate de categoría manda la de mayor exposición.
 *
 * El desempate importa porque `drivingLoanId` es lo que se le muestra al cliente y al analista como
 * la causa: entre dos créditos igual de deteriorados, el que explica la calificación es el que pone
 * el dinero en juego. Sin criterio explícito, la respuesta dependería del orden en que la consulta
 * devolvió las filas y cambiaría entre dos lecturas idénticas.
 */
function worstDebt(debts: readonly RatedDebt[]): RatedDebt {
  return debts.reduce((worst, debt) => {
    if (debt.rating.band.severityRank !== worst.rating.band.severityRank) {
      return debt.rating.band.severityRank > worst.rating.band.severityRank ? debt : worst;
    }
    return debt.rating.exposureCents > worst.rating.exposureCents ? debt : worst;
  });
}

/** Sin arrastre, la calificación la fija la operación de mayor exposición. */
function largestDebt(debts: readonly RatedDebt[]): RatedDebt {
  return debts.reduce((largest, debt) => (debt.rating.exposureCents > largest.rating.exposureCents ? debt : largest));
}
