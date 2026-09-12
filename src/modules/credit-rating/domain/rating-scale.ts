/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system resuelve categoría, previsión y arrastre a partir de bandas versionadas, sin base ni reloj.
 */

/** Una banda de la matriz de calificación, tal como se leyó de `rating_policy_bands`. */
export type RatingBand = {
  grade: string;
  gradeLabel: string;
  severityRank: number;
  minDaysPastDue: number;
  /** `null` = la banda no tiene tope: es la última de la escala. */
  maxDaysPastDue: number | null;
  /** Porcentaje de previsión en tanto por uno (0.20 = 20 %). */
  provisionRate: number;
};

export type LoanRatingInput = {
  daysPastDue: number;
  /** Saldo vivo en céntimos. Se trabaja en enteros: la previsión no puede nacer de un float. */
  exposureCents: number;
  /** Un préstamo castigado ya no se califica por atraso: está en la peor banda por definición. */
  writtenOff: boolean;
};

export type LoanRating = {
  band: RatingBand;
  daysPastDue: number;
  exposureCents: number;
  provisionCents: number;
  reason: 'days_past_due' | 'written_off';
};

/**
 * Ordena la escala de mejor a peor y comprueba que sea utilizable.
 *
 * Una escala con huecos no falla al calificar: devuelve la banda equivocada para los días que nadie
 * cubrió, y lo hace en silencio. Un crédito con 45 días de atraso sobre una matriz que salta de 30 a
 * 61 caería en la peor banda o en ninguna según cómo se recorra, y en ambos casos el resultado es
 * una previsión inventada. Por eso la validación es parte de cargar la política, no un chequeo
 * opcional: la política mal definida tiene que fallar al aprobarse, no al calificar la cartera.
 */
export function normalizeScale(bands: readonly RatingBand[]): RatingBand[] {
  if (bands.length === 0) throw new Error('La política de calificación no tiene bandas definidas.');

  const ordered = [...bands].sort((a, b) => a.severityRank - b.severityRank);

  if (ordered[0].minDaysPastDue !== 0) {
    throw new Error('La primera banda de la escala debe empezar en 0 días de atraso.');
  }
  if (ordered[ordered.length - 1].maxDaysPastDue !== null) {
    throw new Error('La última banda de la escala debe ser abierta (sin tope de días).');
  }

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current.maxDaysPastDue === null) {
      throw new Error(`La banda ${current.grade} es abierta pero no es la última de la escala.`);
    }
    if (next.minDaysPastDue !== current.maxDaysPastDue + 1) {
      throw new Error(`La escala tiene un hueco o un solape entre ${current.grade} y ${next.grade}.`);
    }
  }

  return ordered;
}

/** La banda que corresponde a unos días de atraso. La escala ya se validó: siempre hay una. */
export function bandForDaysPastDue(bands: readonly RatingBand[], daysPastDue: number): RatingBand {
  const ordered = normalizeScale(bands);
  const days = Math.max(0, daysPastDue);
  const match = ordered.find((band) => days >= band.minDaysPastDue && (band.maxDaysPastDue === null || days <= band.maxDaysPastDue));
  // `normalizeScale` garantiza cobertura continua desde 0 hasta infinito, así que esto es
  // inalcanzable; queda como aserción y no como `!` para que un cambio futuro en la validación
  // falle diciendo qué pasó en vez de devolver `undefined` disfrazado de banda.
  if (!match) throw new Error(`Ninguna banda cubre ${days} días de atraso.`);
  return match;
}

/** La peor banda de la escala: la de mayor severidad. Es donde cae un crédito castigado. */
export function worstBand(bands: readonly RatingBand[]): RatingBand {
  const ordered = normalizeScale(bands);
  return ordered[ordered.length - 1];
}

/**
 * Previsión en céntimos: exposición × tasa, redondeada al céntimo más cercano.
 *
 * Se redondea al final y sobre enteros. Multiplicar importes en unidades monetarias con coma
 * flotante y sumar después produce diferencias de céntimos que en un cierre contable no cuadran
 * contra el libro mayor, y el descuadre aparece meses más tarde sin forma de atribuirlo.
 */
export function provisionCentsFor(exposureCents: number, provisionRate: number): number {
  if (exposureCents <= 0) return 0;
  return Math.round(exposureCents * provisionRate);
}

/** Califica UNA deuda: categoría, previsión y por qué se le asignó. */
export function rateLoan(bands: readonly RatingBand[], input: LoanRatingInput): LoanRating {
  const band = input.writtenOff ? worstBand(bands) : bandForDaysPastDue(bands, input.daysPastDue);
  const exposureCents = Math.max(0, input.exposureCents);
  return {
    band,
    daysPastDue: Math.max(0, input.daysPastDue),
    exposureCents,
    provisionCents: provisionCentsFor(exposureCents, band.provisionRate),
    reason: input.writtenOff ? 'written_off' : 'days_past_due',
  };
}
