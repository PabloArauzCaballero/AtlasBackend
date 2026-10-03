/**
 * @file Dominio: la experiencia (puntos por boliviano pagado a tiempo), las rachas y las insignias de un cliente.
 * @business Convierte pagar a tiempo en algo que se ve y se acumula, sin premiar el endeudarse: la experiencia sale de lo que se PAGA, no de lo que se compra.
 * @system función pura sobre las cuotas del cliente; no lee base de datos ni llama al motor.
 *
 * ## La regla de los puntos
 *
 * 1 punto por cada boliviano (parte entera) de una cuota pagada A TIEMPO. Cuenta capital e intereses pagados; no la mora
 * ni el recargo por atraso, porque pagar tarde no debe sumar. Una cuota pagada con atraso suma 0 y rompe la racha.
 *
 * ## Por qué no se gana al comprar
 *
 * Si cada boliviano comprado diera puntos, subir de nivel pediría endeudarse más: justo lo contrario de lo que el
 * puntaje de crédito debe premiar. Comprar no suma; pagar a tiempo sí.
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
  /** Puntos de experiencia: 1 por cada boliviano pagado a tiempo. */
  xp: number;
  onTimeInstallments: number;
  /** Cuotas seguidas a tiempo hasta hoy. */
  currentStreak: number;
  bestStreak: number;
  badges: Badge[];
};

export type ExperienceInput = {
  installments: readonly InstallmentFact[];
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
  const xp = Math.floor(aTiempo.reduce((suma, c) => suma + Math.max(0, c.paidAmount), 0));
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
      current: xp,
      target: 100,
    }),
    badge({
      code: 'mil_bs',
      label: '1.000 Bs a tiempo',
      detail: 'Pagaste 1.000 Bs sin atrasos.',
      icon: 'billetera',
      current: xp,
      target: 1000,
    }),
    badge({
      code: 'cinco_mil_bs',
      label: '5.000 Bs a tiempo',
      detail: 'Pagaste 5.000 Bs sin atrasos.',
      icon: 'estrella',
      current: xp,
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

  return { xp, onTimeInstallments: aTiempo.length, currentStreak: current, bestStreak: best, badges };
}
