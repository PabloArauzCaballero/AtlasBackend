/**
 * @file Dominio: la escalera de nivel de un cliente y lo que le falta para subir, sin infraestructura.
 * @business Convierte la puntuación de relación (0-100) en algo que la persona entiende y puede mover: un nivel, los puntos que le faltan para el siguiente y las acciones que se los dan.
 * @system función pura sobre `PaymentCapacityAssessment` y `RelationshipInput`; no lee base de datos ni llama al motor.
 */
import { RELATIONSHIP_TIERS } from './payment-capacity.js';
import type { PaymentCapacityAssessment, RelationshipInput } from './payment-capacity.types.js';

export type TierCode = PaymentCapacityAssessment['relationshipTier'];

const TIER_LABELS: Record<TierCode, string> = {
  NUEVO: 'Nuevo',
  EN_CONSTRUCCION: 'En construcción',
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
  tier: { code: TierCode; label: string; index: number; of: number; multiplier: number };
  nextTier: { code: TierCode; label: string; from: number; pointsMissing: number; multiplier: number } | null;
  /** De menor a mayor, con la marca de cuáles ya se alcanzaron. */
  ladder: Array<{ code: TierCode; label: string; from: number; multiplier: number; reached: boolean }>;
  components: Array<{ code: string; label: string; value: number; weight: number }>;
  missions: ProgressMission[];
};

/** Los escalones de menor a mayor. `RELATIONSHIP_TIERS` está al revés porque se busca con `find`. */
const ASCENDING = [...RELATIONSHIP_TIERS].reverse();

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

  return {
    score,
    tier: {
      code: current.tier,
      label: TIER_LABELS[current.tier],
      index: index + 1,
      of: ASCENDING.length,
      multiplier: current.multiplier,
    },
    nextTier: next
      ? {
          code: next.tier,
          label: TIER_LABELS[next.tier],
          from: next.from,
          pointsMissing: Math.max(0, next.from - score),
          multiplier: next.multiplier,
        }
      : null,
    ladder: ASCENDING.map((step) => ({
      code: step.tier,
      label: TIER_LABELS[step.tier],
      from: step.from,
      multiplier: step.multiplier,
      reached: score >= step.from,
    })),
    components: COMPONENT_META.map((meta) => ({
      code: meta.code,
      label: meta.label,
      weight: meta.weight,
      value: assessment.components[meta.code],
    })),
    missions,
  };
}
