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

export type InstallmentFact = {
  /** `YYYY-MM-DD`. */
  dueDate: string;
  status: string;
  daysPastDue: number;
  /** Capital + intereses efectivamente pagados. */
  paidAmount: number;
};

export type Badge = {
  code: string;
  label: string;
  detail: string;
  /** Nombre de icono del set de la app. */
  icon: string;
  earned: boolean;
  /** Avance hacia la insignia (`current` de `target`); en las que no son numéricas, 0/1 o 1/1. */
  current: number;
  target: number;
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
 */
function streaks(installments: readonly InstallmentFact[], today: string): { current: number; best: number } {
  const vencidas = installments.filter((c) => c.dueDate <= today || c.status === 'paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let current = 0;
  let best = 0;
  for (const cuota of vencidas) {
    if (isOnTime(cuota)) {
      current += 1;
      best = Math.max(best, current);
    } else if (cuota.status === 'paid' || cuota.dueDate <= today) {
      current = 0;
    }
  }
  return { current, best };
}

/** Una insignia a partir de su definición y su avance; el avance nunca pasa de la meta. */
function badge(def: { code: string; label: string; detail: string; icon: string; current: number; target: number }): Badge {
  return { ...def, earned: def.current >= def.target, current: Math.min(def.current, def.target) };
}

export function buildExperience(input: ExperienceInput): Experience {
  const aTiempo = input.installments.filter(isOnTime);
  // Un importe negativo o no numérico (nunca debería llegar) no resta ni rompe la cuenta.
  const positivo = (valor: number) => (Number.isFinite(valor) && valor > 0 ? valor : 0);
  const xp = Math.floor(input.purchaseAmounts.reduce((suma, monto) => suma + positivo(monto), 0));
  const pagadoATiempo = Math.floor(aTiempo.reduce((suma, c) => suma + positivo(c.paidAmount), 0));
  const { current, best } = streaks(input.installments, input.today);

  const badges: Badge[] = [
    badge({
      code: 'primera_compra',
      label: 'Primera compra',
      detail: 'Hiciste tu primera compra con Atlas.',
      icon: 'comercio',
      current: input.loansEver,
      target: 1,
    }),
    badge({
      code: 'primer_pago',
      label: 'Primer pago a tiempo',
      detail: 'Pagaste una cuota sin atraso.',
      icon: 'check',
      current: aTiempo.length,
      target: 1,
    }),
    badge({ code: 'racha_3', label: 'Racha de 3', detail: 'Tres cuotas seguidas a tiempo.', icon: 'tendencia', current: best, target: 3 }),
    badge({ code: 'racha_6', label: 'Racha de 6', detail: 'Seis cuotas seguidas a tiempo.', icon: 'tendencia', current: best, target: 6 }),
    badge({
      code: 'compra_cerrada',
      label: 'Compra cerrada',
      detail: 'Terminaste de pagar una compra completa.',
      icon: 'escudo',
      current: input.loansSettled,
      target: 1,
    }),
    badge({
      code: 'cien_bs',
      label: '100 Bs a tiempo',
      detail: 'Pagaste 100 Bs sin atrasos.',
      icon: 'billetera',
      current: pagadoATiempo,
      target: 100,
    }),
    badge({
      code: 'mil_bs',
      label: '1.000 Bs a tiempo',
      detail: 'Pagaste 1.000 Bs sin atrasos.',
      icon: 'billetera',
      current: pagadoATiempo,
      target: 1000,
    }),
    badge({
      code: 'cinco_mil_bs',
      label: '5.000 Bs a tiempo',
      detail: 'Pagaste 5.000 Bs sin atrasos.',
      icon: 'estrella',
      current: pagadoATiempo,
      target: 5000,
    }),
    badge({
      code: 'identidad',
      label: 'Identidad verificada',
      detail: 'Confirmaste tu identidad, domicilio y contacto.',
      icon: 'perfil',
      current: input.kycComplete ? 1 : 0,
      target: 1,
    }),
    badge({
      code: 'un_ano',
      label: 'Un año con Atlas',
      detail: 'Llevas doce meses con nosotros.',
      icon: 'reloj',
      current: input.tenureMonths,
      target: 12,
    }),
  ];

  return { xp, paidOnTime: pagadoATiempo, onTimeInstallments: aTiempo.length, currentStreak: current, bestStreak: best, badges };
}
