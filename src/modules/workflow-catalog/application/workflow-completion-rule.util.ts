/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { EligibilityAssessment } from '../../customers/application/customer-eligibility.evaluator.js';
import { OPERATION_BLOCKING_STATUSES } from '../../customers/customer-lifecycle.constants.js';
import { WorkflowProgressStatus } from '../workflow-catalog.constants.js';

export type StageProgress = { status: WorkflowProgressStatus; reason: string | null };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Traduce la regla de completitud declarada de una etapa al estado real del cliente.
 *
 * Función pura: recibe la regla (JSON del catálogo) y la evaluación de habilitación ya calculada, y
 * devuelve un estado. No consulta la base ni depende de Nest, de modo que cada rama del `switch` es
 * verificable con un test directo — que es exactamente lo que se necesita de la pieza que decide
 * qué ve el cliente en su pantalla de avance.
 *
 * Una regla desconocida o ausente NO se asume cumplida: devuelve `pending` con motivo explícito. Dar
 * por completada una etapa que el sistema no sabe evaluar es la forma más rápida de mostrarle a un
 * cliente que terminó un trámite que en realidad no hizo.
 */
export function resolveStageProgress(rule: Record<string, unknown>, assessment: EligibilityAssessment): StageProgress {
  if ((OPERATION_BLOCKING_STATUSES as readonly string[]).includes(assessment.lifecycleStatus)) {
    return { status: 'blocked', reason: `LIFECYCLE_STATUS_${assessment.lifecycleStatus.toUpperCase()}` };
  }

  switch (rule.type) {
    case 'onboarding_section': {
      const sectionCode = typeof rule.sectionCode === 'string' ? rule.sectionCode : null;
      const section = assessment.sections.find((candidate) => candidate.code === sectionCode);
      if (!section) return { status: 'pending', reason: `UNKNOWN_SECTION_${sectionCode ?? 'MISSING'}` };
      if (section.status === 'completed') return { status: 'completed', reason: null };
      return { status: 'pending', reason: section.missingFields.length > 0 ? `MISSING_${section.missingFields.join(',')}` : null };
    }

    case 'lifecycle_status': {
      const statuses = asStringArray(rule.statuses);
      if (statuses.includes(assessment.lifecycleStatus)) return { status: 'completed', reason: null };
      return { status: 'pending', reason: `REQUIRES_STATUS_${statuses.join('|') || 'UNSPECIFIED'}` };
    }

    case 'no_blockers': {
      const codes = asStringArray(rule.blockerCodes);
      const active = assessment.blockers.filter((blocker) => codes.includes(blocker.code)).map((blocker) => blocker.code);
      if (active.length === 0) return { status: 'completed', reason: null };
      return { status: 'pending', reason: `ACTIVE_BLOCKERS_${active.join(',')}` };
    }

    case 'manual':
      // No hay señal automática para esta etapa (decisión de un analista, por ejemplo). Se reporta
      // como no aplicable para que el frontend no la muestre como algo que el cliente pueda hacer.
      return { status: 'not_applicable', reason: 'MANUAL_STAGE' };

    default:
      return { status: 'pending', reason: 'NO_COMPLETION_RULE' };
  }
}
