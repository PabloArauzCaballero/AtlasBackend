/**
 * @file Dominio: la escalera de nivel de un cliente y lo que le falta para subir, sin infraestructura.
 * @business Convierte la puntuación de relación (0-100) en algo que la persona entiende y puede mover: un nivel, los puntos que le faltan para el siguiente y las acciones que se los dan.
 * @system función pura sobre `PaymentCapacityAssessment` y `RelationshipInput`; no lee base de datos ni llama al motor.
 */
import { DEFAULT_CAPACITY_POLICY, RELATIONSHIP_TIERS, round2 } from './payment-capacity.js';
import type { PaymentCapacityAssessment, RelationshipInput } from './payment-capacity.types.js';

export type TierCode = PaymentCapacityAssessment['relationshipTier'];

const TIER_LABELS: Record<TierCode, string> = {
  NUEVO: 'Nuevo',
  EN_CONSTRUCCION: 'En crecimiento',
  ESTABLECIDO: 'Establecido',
  CONSOLIDADO: 'Consolidado',
  PREFERENTE: 'Preferente',
};

/** Cuánto pesa cada componente en la puntuación. Se publica para que la pantalla pueda explicar el reparto. */
const COMPONENT_META = [
  { code: 'paymentHistory', label: 'Pagos a tiempo', weight: 0.45 },
  { code: 'loyalty', label: 'Compras terminadas de pagar', weight: 0.25 },
  { code: 'tenure', label: 'Antigüedad', weight: 0.2 },
  { code: 'verification', label: 'Identidad verificada', weight: 0.1 },
] as const;

export type ProgressMission = { code: string; label: string; detail: string; done: boolean; points: string };

export type RelationshipProgress = {
  score: number;
  /**
   * `creditCeiling`: hasta cuánto crédito admite ese escalón, en dinero. Es el TOPE por confianza (`starterCap` ×
   * `multiplier`, sin pasar del techo del producto), el mismo que usa `assessPaymentCapacity`; NO es el límite, que es
   * además lo que la persona puede pagar y lo decide el motor. Se publica para que la app pueda decir «hasta Bs X» sin
   * tener escrito ningún importe: antes sólo llegaba el multiplicador y la pantalla no podía decir cuánto crece el crédito.
   */
  tier: { code: TierCode; label: string; index: number; of: number; multiplier: number; creditCeiling: number };
  nextTier: { code: TierCode; label: string; from: number; pointsMissing: number; multiplier: number; creditCeiling: number } | null;
  /** De menor a mayor, con la marca de cuáles ya se alcanzaron. */
  ladder: Array<{ code: TierCode; label: string; from: number; multiplier: number; creditCeiling: number; reached: boolean }>;
  /**
   * La cuenta de ESTA persona: cada parte con su valor 0-100, su peso, los puntos que aporta (valor × peso) y la razón
   * en una frase. Los `points` suman `rawScore`; si un tope recortó el resultado, `score` es menor y `caps` dice cuál.
   */
  components: Array<{ code: string; label: string; value: number; weight: number; points: number; why: string }>;
  /** La suma de los puntos antes de aplicar topes. */
  rawScore: number;
  /** Los topes que de verdad recortaron el resultado de esta persona (casi siempre ninguno). */
  caps: Array<{ code: string; limit: number; detail: string }>;
  missions: ProgressMission[];
};

/** Los escalones de menor a mayor. `RELATIONSHIP_TIERS` está al revés porque se busca con `find`. */
const ASCENDING = [...RELATIONSHIP_TIERS].reverse();

/** El tope de crédito de un escalón con la política vigente: la misma cuenta que `byRelationship`, acotada al producto. */
export function creditCeilingOf(multiplier: number): number {
  return Math.min(DEFAULT_CAPACITY_POLICY.productCeiling, round2(DEFAULT_CAPACITY_POLICY.starterCap * multiplier));
}

/**
 * Las acciones que dan puntos, con su estado según la conducta real. Aparte de `buildRelationshipProgress`
 * para que cada una se pueda leer y cambiar sin tocar el cálculo del nivel.
 */
function buildMissions(assessment: PaymentCapacityAssessment, relationship: RelationshipInput): ProgressMission[] {
  return [
    {
      code: 'verificar_identidad',
      label: 'Verifica tu identidad',
      detail: 'Cédula, domicilio y contacto confirmados.',
      done: relationship.kycComplete,
      points: 'hasta +10',
    },
    {
      code: 'pagar_a_tiempo',
      label: 'Paga tus cuotas a tiempo',
      detail: 'Es lo que más pesa: casi la mitad de tu puntuación.',
      done: relationship.onTimeRatio !== null && relationship.onTimeRatio >= 0.95,
      points: 'hasta +45',
    },
    {
      code: 'terminar_una_compra',
      label: 'Termina de pagar una compra',
      detail: 'Cada compra cerrada sin atrasos fortalece tu historial.',
      done: relationship.loansSettled >= 1,
      points: 'hasta +15',
    },
    {
      code: 'cero_atrasos',
      label: 'Mantén cero atrasos',
      detail: 'Un atraso pesa durante doce meses.',
      done: relationship.worstDaysPastDue === 0 && relationship.delinquencyCount12m === 0,
      points: 'protege tu nivel',
    },
    {
      code: 'cumplir_un_ano',
      label: 'Cumple un año con Atlas',
      detail: 'La antigüedad suma hasta cumplir doce meses.',
      done: relationship.tenureMonths >= 12,
      points: 'hasta +20',
    },
    {
      code: 'subir_extracto',
      label: 'Sube tu extracto bancario',
      detail: 'No suma puntos, pero demuestra lo que puedes pagar y sube tu límite.',
      done: assessment.evidence === 'EXTRACTO',
      points: 'sube tu límite',
    },
  ];
}

/** Una frase con la razón del valor de cada parte, con los números de ESTA persona. */
function explainComponents(relationship: RelationshipInput): Record<(typeof COMPONENT_META)[number]['code'], string> {
  const sinHistorial = relationship.onTimeRatio === null && relationship.loansSettled === 0 && relationship.loansActive === 0;
  const penalizaciones: string[] = [];
  if (relationship.worstDaysPastDue >= 90) penalizaciones.push('un atraso de 90 días o más (−60)');
  else if (relationship.worstDaysPastDue >= 30) penalizaciones.push('un atraso de 30 días o más (−30)');
  else if (relationship.worstDaysPastDue >= 1) penalizaciones.push('algún atraso (−10)');
  if (relationship.chargeOffCount > 0) penalizaciones.push('una compra castigada (−70)');
  if (relationship.delinquencyCount12m > 0)
    penalizaciones.push(
      `${String(relationship.delinquencyCount12m)} cuota(s) vencida(s) en el último año (−${String(Math.min(30, relationship.delinquencyCount12m * 10))})`,
    );

  return {
    paymentHistory: sinHistorial
      ? 'Todavía no hay cuotas que pagar, así que partes de 50: un valor neutro, para no castigarte por no haber pedido nunca.'
      : `Pagaste a tiempo el ${String(Math.round((relationship.onTimeRatio ?? 0) * 100))} % de tus cuotas${penalizaciones.length ? `, y se descuenta ${penalizaciones.join(', ')}` : ''}.`,
    loyalty:
      relationship.loansSettled === 0 && relationship.loansActive === 0
        ? 'Todavía no cerraste ninguna compra: cada una terminada de pagar suma 20 (hasta 60) y cada una activa, 10 (hasta 20).'
        : `${String(relationship.loansSettled)} compra(s) cerrada(s) (20 cada una, hasta 60) y ${String(relationship.loansActive)} activa(s) (10 cada una, hasta 20), más un poco si compraste hace poco.`,
    tenure:
      relationship.tenureMonths >= 12
        ? `Llevas ${String(relationship.tenureMonths)} meses con Atlas: ya tienes el máximo de esta parte.`
        : `Llevas ${String(relationship.tenureMonths)} mes(es) con Atlas; esta parte llega a 100 a los 12 meses.`,
    verification: relationship.kycComplete
      ? 'Tu identidad, domicilio y contacto están verificados.'
      : 'Todavía no verificamos tu identidad: al hacerlo suma 100 a esta parte.',
  };
}

/** Los topes que de verdad aplican a esta persona. Mismos umbrales que `assessPaymentCapacity`. */
function appliedCaps(relationship: RelationshipInput, raw: number): RelationshipProgress['caps'] {
  const caps: RelationshipProgress['caps'] = [];
  if (relationship.fraudFlags > 0 && raw > 10) {
    caps.push({
      code: 'ALERTA_DE_FRAUDE',
      limit: 10,
      detail: 'Hay una alerta abierta sobre tu cuenta: tu nivel no sube mientras siga abierta.',
    });
  }
  const haGanadoRelacion = relationship.tenureMonths >= 3 || relationship.loansSettled > 0;
  if (!haGanadoRelacion && raw > 24) {
    caps.push({
      code: 'RELACION_NUEVA',
      limit: 24,
      detail: 'Hasta cumplir 3 meses con Atlas o cerrar una compra, el máximo es 24: el nivel mide confianza ganada, no sólo datos.',
    });
  }
  return caps;
}

/**
 * El nivel, lo que falta y las misiones.
 *
 * Las misiones NO premian endeudarse: todas son conductas que hacen más confiable a la persona (verificarse,
 * pagar a tiempo, no atrasarse, sostener la relación). Pedir más crédito no suma ni un punto.
 */
export function buildRelationshipProgress(assessment: PaymentCapacityAssessment, relationship: RelationshipInput): RelationshipProgress {
  const score = assessment.relationshipScore;
  const index = ASCENDING.findIndex((step) => step.tier === assessment.relationshipTier);
  const current = ASCENDING[index]!;
  const next = ASCENDING[index + 1] ?? null;

  const missions = buildMissions(assessment, relationship);
  const razones = explainComponents(relationship);
  const components = COMPONENT_META.map((meta) => {
    const value = assessment.components[meta.code];
    return {
      code: meta.code,
      label: meta.label,
      weight: meta.weight,
      value,
      points: Math.round(value * meta.weight * 10) / 10,
      why: razones[meta.code],
    };
  });
  const rawScore = Math.round(components.reduce((suma, c) => suma + c.value * c.weight, 0));

  return {
    score,
    tier: {
      code: current.tier,
      label: TIER_LABELS[current.tier],
      index: index + 1,
      of: ASCENDING.length,
      multiplier: current.multiplier,
      creditCeiling: creditCeilingOf(current.multiplier),
    },
    nextTier: next
      ? {
          code: next.tier,
          label: TIER_LABELS[next.tier],
          from: next.from,
          pointsMissing: Math.max(0, next.from - score),
          multiplier: next.multiplier,
          creditCeiling: creditCeilingOf(next.multiplier),
        }
      : null,
    ladder: ASCENDING.map((step) => ({
      code: step.tier,
      label: TIER_LABELS[step.tier],
      from: step.from,
      multiplier: step.multiplier,
      creditCeiling: creditCeilingOf(step.multiplier),
      reached: score >= step.from,
    })),
    components,
    rawScore,
    caps: appliedCaps(relationship, rawScore),
    missions,
  };
}
