/**
 * @file Dominio: la experiencia (puntos por boliviano COMPRADO), las rachas y las insignias de un cliente.
 * @business Pablo (2026-10-06): «una cosa son los puntos de calificación y otra los puntos de experiencia. En los de
 *   experiencia, cada peso comprado es un punto, y dan los niveles». La experiencia mide cuánto USA Atlas la persona;
 *   qué tan buen pagador es lo mide la Calificación 1-100 (`payer-rating.ts`), que es la que mira el crédito.
 * @system función pura sobre las compras y las cuotas del cliente; no lee base de datos ni llama al motor.
 *
 * ## La regla de los puntos
 *
 * 1 punto por cada boliviano (parte entera) del monto de cada compra hecha con Atlas: los créditos `active` y
 * `paid_off`. No cuentan los anulados ni los que aún esperan desembolso (la compra no se concretó), ni los castigados
 * (`written_off`): una compra que no se pagó no puede seguir dando nivel.
 *
 * ## El nivel no toca el monto
 *
 * Antes la experiencia salía de lo pagado a tiempo, para no premiar el endeudarse. Ese riesgo no desaparece, pero
 * queda acotado: el nivel y la tarjeta Normal…Black son presentación y estatus (`points-level.ts`); el límite lo
 * decide el motor con la puntuación de relación, que sigue midiendo pagos a tiempo. Las rachas y las insignias de
 * pago siguen saliendo de las cuotas pagadas a tiempo.
 */

import { buildBadges, type Badge } from './experience-badges.js';

export type { Badge, BadgeCategory, BadgeRank } from './experience-badges.js';

export type InstallmentFact = {
  /** `YYYY-MM-DD`. */
  dueDate: string;
  status: string;
  daysPastDue: number;
  /** Capital + intereses efectivamente pagados. */
  paidAmount: number;
  /** `YYYY-MM-DD` (hora de Bolivia) en que se saldó la cuota; sin dato, las insignias de estilo de pago no cuentan. */
  paidOn?: string | null;
};

export type Experience = {
  /** Puntos de experiencia: 1 por cada boliviano comprado con Atlas. */
  xp: number;
  /** Bolivianos pagados a tiempo (capital + intereses): lo que miden las insignias de pago. */
  paidOnTime: number;
  onTimeInstallments: number;
  /** Cuotas seguidas a tiempo hasta hoy. */
  currentStreak: number;
  bestStreak: number;
  badges: Badge[];
};

export type ExperienceInput = {
  installments: readonly InstallmentFact[];
  /** El monto de cada compra que cuenta para la experiencia (créditos `active` y `paid_off`). */
  purchaseAmounts: readonly number[];
  /** Compras con su crédito activo o desembolsado alguna vez. */
  loansEver: number;
  loansSettled: number;
  kycComplete: boolean;
  tenureMonths: number;
  /** Hoy, `YYYY-MM-DD`: lo vencido y no pagado rompe la racha. */
  today: string;
};

const isOnTime = (cuota: InstallmentFact) => cuota.status === 'paid' && cuota.daysPastDue <= 0;

/**
 * Racha: cuotas SEGUIDAS a tiempo, de la más antigua a la más reciente. Una cuota pagada tarde o vencida sin pagar la
 * rompe; las que aún no vencen no cuentan ni a favor ni en contra.
 *
 * `rebound` es la remontada: tras romper la racha, volver a juntar tres a tiempo. Existe para que fallar una vez no
 * sea el final del juego: quien tropieza y se levanta también gana algo.
 */
function streaks(installments: readonly InstallmentFact[], today: string): { current: number; best: number; rebound: boolean } {
  const vencidas = installments.filter((c) => c.dueDate <= today || c.status === 'paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let current = 0;
  let best = 0;
  let roto = false;
  let rebound = false;
  for (const cuota of vencidas) {
    if (isOnTime(cuota)) {
      current += 1;
      best = Math.max(best, current);
      if (roto && current >= 3) rebound = true;
    } else if (cuota.status === 'paid' || cuota.dueDate <= today) {
      current = 0;
      roto = true;
    }
  }
  return { current, best, rebound };
}

const MS_DIA = 86_400_000;
const diaUtc = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`);

/** Días de adelanto con que se pagó una cuota a tiempo (0 si el mismo día; negativo no ocurre en una a tiempo). */
function diasDeAdelanto(cuota: InstallmentFact): number | null {
  if (!cuota.paidOn) return null;
  const venc = diaUtc(cuota.dueDate);
  const pago = diaUtc(cuota.paidOn);
  if (!Number.isFinite(venc) || !Number.isFinite(pago)) return null;
  return Math.round((venc - pago) / MS_DIA);
}

const esDomingo = (fecha: string) => new Date(diaUtc(fecha)).getUTCDay() === 0;

export function buildExperience(input: ExperienceInput): Experience {
  const aTiempo = input.installments.filter(isOnTime);
  // Un importe negativo o no numérico (nunca debería llegar) no resta ni rompe la cuenta.
  const positivo = (valor: number) => (Number.isFinite(valor) && valor > 0 ? valor : 0);
  const compras = input.purchaseAmounts.map(positivo);
  const xp = Math.floor(compras.reduce((suma, monto) => suma + monto, 0));
  const pagadoATiempo = Math.floor(aTiempo.reduce((suma, c) => suma + positivo(c.paidAmount), 0));
  const { current, best, rebound } = streaks(input.installments, input.today);
  const mayorCompra = compras.reduce((mayor, monto) => Math.max(mayor, monto), 0);
  const adelantos = aTiempo.map(diasDeAdelanto).filter((d): d is number => d !== null);
  const madrugadas = adelantos.filter((d) => d >= 3).length;
  const alFilo = adelantos.filter((d) => d === 0).length;
  const enDomingo = aTiempo.filter((c) => c.paidOn && esDomingo(c.paidOn)).length;

  const badges = buildBadges({
    comprasHechas: input.loansEver,
    comprasCerradas: input.loansSettled,
    compras: compras.length,
    mayorCompra,
    cuotasATiempo: aTiempo.length,
    pagadoATiempo,
    mejorRacha: best,
    remontada: rebound ? 1 : 0,
    madrugadas,
    alFilo,
    enDomingo,
    identidad: input.kycComplete ? 1 : 0,
    meses: input.tenureMonths,
  });

  return {
    xp,
    paidOnTime: pagadoATiempo,
    onTimeInstallments: aTiempo.length,
    currentStreak: current,
    bestStreak: best,
    badges,
  };
}
