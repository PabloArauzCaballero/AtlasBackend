/**
 * @file Regla de dominio pura: cómo el impacto y la urgencia producen una prioridad.
 * @business Evita que la prioridad la ponga quien grita más fuerte y no quien más lo necesita.
 * @system matriz determinista impacto × urgencia, con elevación forzada para seguridad y fraude.
 */
import {
  SECURITY_SENSITIVE_CASE_TYPES,
  type SupportCaseType,
  type SupportImpact,
  type SupportPriority,
  type SupportUrgency,
} from '../support.constants.js';

/** Peso del alcance: a cuánta gente afecta. */
const IMPACT_WEIGHT: Readonly<Record<SupportImpact, number>> = {
  INDIVIDUAL: 0,
  MULTI_USER: 1,
  PARTNER: 1,
  MULTI_PARTNER: 2,
  REGIONAL: 3,
  PLATFORM_WIDE: 4,
};

/** Peso del apremio: cuánto cuesta cada hora de espera. */
const URGENCY_WEIGHT: Readonly<Record<SupportUrgency, number>> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 4,
};

/**
 * Prioridad = f(impacto, urgencia), y no un desplegable libre.
 *
 * Severidad y prioridad no son lo mismo: un error grave que afecta a una sola persona con un rodeo
 * disponible no desplaza a una caída de autenticación. Con la matriz, esa comparación la hace la
 * regla y no el ánimo del turno; y como es determinista, dos agentes clasifican igual el mismo caso,
 * que es la condición para que la métrica de cumplimiento signifique algo.
 *
 * ## Por qué seguridad y fraude tienen un piso
 *
 * Porque su impacto real es desconocido en el momento de abrirlos: quien reporta que le tomaron la
 * cuenta no sabe todavía cuánto se movió. Tratarlos como «individual + normal» los pondría en la
 * cola de las consultas, y para cuando el impacto se conoce, ya ocurrió. El piso es P2, y sube a P1
 * en cuanto la urgencia declarada es crítica o el alcance pasa de una persona.
 */
export function derivePriority(input: {
  impact: SupportImpact;
  urgency: SupportUrgency;
  caseType: SupportCaseType;
}): SupportPriority {
  const score = IMPACT_WEIGHT[input.impact] + URGENCY_WEIGHT[input.urgency];
  let priority: SupportPriority = score >= 5 ? 'P1' : score >= 3 ? 'P2' : score >= 1 ? 'P3' : 'P4';

  if (SECURITY_SENSITIVE_CASE_TYPES.includes(input.caseType)) {
    const criticalScope = input.urgency === 'CRITICAL' || IMPACT_WEIGHT[input.impact] >= 1;
    priority = criticalScope ? 'P1' : raiseTo(priority, 'P2');
  }

  // Un reclamo formal nunca es una consulta informativa: tiene plazos de respuesta propios.
  if (input.caseType === 'COMPLAINT') priority = raiseTo(priority, 'P3');

  return priority;
}

const ORDER: readonly SupportPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** Sube la prioridad hasta el piso indicado; nunca la baja. */
export function raiseTo(current: SupportPriority, floor: SupportPriority): SupportPriority {
  return ORDER.indexOf(current) <= ORDER.indexOf(floor) ? current : floor;
}

/** Cuál de las dos prioridades es más exigente. Útil al fusionar caso y categoría. */
export function mostUrgent(a: SupportPriority, b: SupportPriority): SupportPriority {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}
