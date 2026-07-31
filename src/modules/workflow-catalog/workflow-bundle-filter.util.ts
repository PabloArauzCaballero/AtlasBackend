/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { WorkflowBundle } from './workflow-catalog.repository.js';

export type WorkflowBundleFilter = {
  moduleCode?: string;
  role?: string;
  lifecycleStatus?: string;
  actorType?: string;
};

function matchesRole(allowedRoles: readonly string[] | null | undefined, role: string): boolean {
  // Una lista vacía significa "cualquier actor autenticado" (así se siembran los pasos sin @Roles).
  const roles = allowedRoles ?? [];
  return roles.length === 0 || roles.includes(role);
}

function matchesState(requiredStates: readonly string[] | null | undefined, lifecycleStatus: string): boolean {
  // Sin estados declarados, la etapa no impone precondición de ciclo de vida: aplica siempre.
  const states = requiredStates ?? [];
  return states.length === 0 || states.includes(lifecycleStatus);
}

/**
 * Recorta un bundle a lo que pidió el consumidor sin dejar el grafo inconsistente.
 *
 * Tres invariantes que un filtro ingenuo rompe y aquí se preservan:
 *
 *  1. Si una subetapa sobrevive, su cadena de ancestros también — de lo contrario el árbol pierde el
 *     nivel intermedio y las subetapas aparecen colgando de la raíz como si fueran de primer nivel.
 *  2. Los pasos de una etapa descartada se descartan con ella.
 *  3. Transiciones y dependencias que apunten a un paso descartado se eliminan: una arista hacia un
 *     nodo inexistente es peor que no tener la arista (el frontend dibujaría una flecha al vacío).
 */
export function filterWorkflowBundle(bundle: WorkflowBundle, filter: WorkflowBundleFilter): WorkflowBundle {
  const hasStageFilter = Boolean(filter.moduleCode || filter.lifecycleStatus || filter.actorType);
  const hasStepFilter = Boolean(filter.role);
  if (!hasStageFilter && !hasStepFilter) return bundle;

  const stageById = new Map(bundle.stages.map((stage) => [String(stage.id), stage]));

  const directlyKept = new Set(
    bundle.stages
      .filter((stage) => {
        if (filter.moduleCode && stage.moduleCode !== filter.moduleCode) return false;
        if (filter.actorType && stage.actorType !== filter.actorType) return false;
        if (filter.lifecycleStatus && !matchesState(stage.requiredStates, filter.lifecycleStatus)) return false;
        return true;
      })
      .map((stage) => String(stage.id)),
  );

  // Invariante 1: subir por la cadena de padres de cada etapa conservada.
  const keptStageIds = new Set(directlyKept);
  for (const id of directlyKept) {
    let parentId = stageById.get(id)?.parentStageId ?? null;
    while (parentId !== null && !keptStageIds.has(String(parentId))) {
      keptStageIds.add(String(parentId));
      parentId = stageById.get(String(parentId))?.parentStageId ?? null;
    }
  }

  const steps = bundle.steps.filter((step) => {
    if (!keptStageIds.has(String(step.workflowStageId))) return false;
    if (filter.role && !matchesRole(step.allowedRoles, filter.role)) return false;
    return true;
  });

  // Una etapa hoja que perdió todos sus pasos por el filtro de rol deja de ser relevante; una etapa
  // con subetapas conservadas se mantiene aunque ella misma no tenga pasos propios.
  const stagesWithSteps = new Set(steps.map((step) => String(step.workflowStageId)));
  const stageHasKeptDescendant = (stageId: string): boolean =>
    bundle.stages.some((candidate) => {
      if (String(candidate.parentStageId ?? '') !== stageId || !keptStageIds.has(String(candidate.id))) return false;
      return stagesWithSteps.has(String(candidate.id)) || stageHasKeptDescendant(String(candidate.id));
    });

  const stages = bundle.stages.filter((stage) => {
    const id = String(stage.id);
    if (!keptStageIds.has(id)) return false;
    if (!hasStepFilter) return true;
    return stagesWithSteps.has(id) || stageHasKeptDescendant(id);
  });

  const finalStageIds = new Set(stages.map((stage) => String(stage.id)));
  const finalSteps = steps.filter((step) => finalStageIds.has(String(step.workflowStageId)));
  const stepIds = new Set(finalSteps.map((step) => String(step.id)));

  return {
    definition: bundle.definition,
    stages,
    steps: finalSteps,
    dependencies: bundle.dependencies.filter(
      (dependency) => stepIds.has(String(dependency.stepId)) && stepIds.has(String(dependency.dependsOnStepId)),
    ),
    transitions: bundle.transitions.filter((transition) => {
      const fromOk = transition.fromStepId === null || stepIds.has(String(transition.fromStepId));
      const toOk = transition.toStepId === null || stepIds.has(String(transition.toStepId));
      return fromOk && toOk;
    }),
  };
}
