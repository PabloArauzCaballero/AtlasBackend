/**
 * @file Dominio: los puntos de experiencia, las rachas y las insignias de un cliente.
 * @business Pablo (2026-10-08): «el sistema de puntos está totalmente mal, se consiguen de una; piensa en el de
 *   Farmacorp». Con 1 punto por boliviano comprado, una sola compra de Bs 1.200 subía tres niveles de golpe y los
 *   puntos premiaban endeudarse. Ahora se ganan como en un programa de fidelidad (Farmaclub da 1 punto por Bs 1 de
 *   compra), pero en Atlas pesa más CUMPLIR que comprar: lo que se premia es pagar bien.
 * @system función pura sobre las compras y las cuotas del cliente; no lee base de datos ni llama al motor.
 *
 * ## La regla de los puntos (`REGLA_DE_PUNTOS`)
 *
 *  - Cada compra (créditos `active` y `paid_off`): 1 punto por cada Bs 10, con un TOPE por compra. Comprar mucho de
 *    una vez no salta niveles.
 *  - Cada cuota pagada a tiempo: 50 puntos.
 *  - Cada cuota pagada con 3 días o más de adelanto: 25 puntos más.
 *  - Cada compra terminada de pagar: 200 puntos.
 *
 * No cuentan los créditos anulados, los que esperan desembolso ni los castigados (`written_off`). Una cuota pagada tarde
 * no da puntos. Los escalones del nivel (`points-level.ts`) no cambian: cambia cómo se llega a ellos.
 *
 * ## El nivel no toca el monto
 *
 * El nivel y la tarjeta Normal…Black son presentación y estatus (`points-level.ts`); el límite lo decide el motor con
 * la puntuación de relación, que mide pagos a tiempo.
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

/** Cuánto vale cada cosa que hace el cliente. Se cambia aquí y la app la recibe en `xpBreakdown`. */
export const REGLA_DE_PUNTOS = {
  /** Bolivianos de compra por cada punto. */
  bolivianosPorPunto: 10,
  /** Puntos máximos que da UNA compra, por grande que sea. */
  topePorCompra: 100,
  cuotaATiempo: 50,
  /** Extra por pagar con `diasDeAdelanto` días o más de anticipación. */
  cuotaAdelantada: 25,
  diasDeAdelanto: 3,
  compraTerminada: 200,
} as const;

/** De dónde salen los puntos: lo que la app enseña en «Mis puntos». */
export type XpBreakdown = {
  purchases: { count: number; points: number };
  onTimeInstallments: { count: number; points: number };
  earlyInstallments: { count: number; points: number };
  settledPurchases: { count: number; points: number };
};

export type Experience = {
  /** Puntos de experiencia: la suma de `xpBreakdown` (ver `REGLA_DE_PUNTOS`). */
  xp: number;
  xpBreakdown: XpBreakdown;
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
  const puntosDeCompra = compras.reduce(
    (suma, monto) => suma + Math.min(REGLA_DE_PUNTOS.topePorCompra, Math.floor(monto / REGLA_DE_PUNTOS.bolivianosPorPunto)),
    0,
  );
  const pagadoATiempo = Math.floor(aTiempo.reduce((suma, c) => suma + positivo(c.paidAmount), 0));
  const { current, best, rebound } = streaks(input.installments, input.today);
  const mayorCompra = compras.reduce((mayor, monto) => Math.max(mayor, monto), 0);
  const adelantos = aTiempo.map(diasDeAdelanto).filter((d): d is number => d !== null);
  const madrugadas = adelantos.filter((d) => d >= REGLA_DE_PUNTOS.diasDeAdelanto).length;
  const terminadas = Math.max(0, Math.floor(input.loansSettled));
  const xpBreakdown: XpBreakdown = {
    purchases: { count: compras.filter((monto) => monto > 0).length, points: puntosDeCompra },
    onTimeInstallments: { count: aTiempo.length, points: aTiempo.length * REGLA_DE_PUNTOS.cuotaATiempo },
    earlyInstallments: { count: madrugadas, points: madrugadas * REGLA_DE_PUNTOS.cuotaAdelantada },
    settledPurchases: { count: terminadas, points: terminadas * REGLA_DE_PUNTOS.compraTerminada },
  };
  const xp = Object.values(xpBreakdown).reduce((suma, parte) => suma + parte.points, 0);
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
    xpBreakdown,
    paidOnTime: pagadoATiempo,
    onTimeInstallments: aTiempo.length,
    currentStreak: current,
    bestStreak: best,
    badges,
  };
}
