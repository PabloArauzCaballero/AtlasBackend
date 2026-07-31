/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { WorkflowGraphDto } from './workflow-catalog.dtos.js';
import { WorkflowBundle } from './workflow-catalog.repository.js';

const STAGE_NODE_PREFIX = 'stage:';
const STEP_NODE_PREFIX = 'step:';

/**
 * Proyección nodos/aristas del flujo, lista para una librería de diagramas.
 *
 * Se devuelve en vez de dejar que el frontend derive el grafo del árbol por dos razones concretas:
 * la jerarquía etapa→subetapa→paso y las transiciones entre pasos son dos relaciones distintas que
 * el árbol no expresa a la vez, y una segunda implementación del recorrido en el cliente sería una
 * copia de esta regla que se desincronizaría en la primera versión nueva del flujo.
 *
 * Los identificadores llevan prefijo de tipo porque etapa y paso tienen secuencias independientes:
 * sin él, `stage 7` y `step 7` colisionarían y el diagrama uniría dos nodos que no se relacionan.
 */
export function buildWorkflowGraph(bundle: WorkflowBundle): WorkflowGraphDto {
  const stageById = new Map(bundle.stages.map((stage) => [String(stage.id), stage]));
  const stepById = new Map(bundle.steps.map((step) => [String(step.id), step]));

  return {
    workflowCode: bundle.definition.workflowCode,
    version: bundle.definition.version,
    status: bundle.definition.status,
    nodes: [...bundle.stages.map((stage) => stageNode(stage, stageById)), ...bundle.steps.map((step) => stepNode(step, stageById))],
    edges: [
      ...bundle.transitions.map((transition) => transitionEdge(transition, stepById)),
      ...bundle.dependencies.map((dependency) => dependencyEdge(dependency, stepById)).filter(isEdge),
    ],
  };
}

type GraphNode = WorkflowGraphDto['nodes'][number];
type GraphEdge = WorkflowGraphDto['edges'][number];

function stageNode(stage: WorkflowBundle['stages'][number], stageById: Map<string, WorkflowBundle['stages'][number]>): GraphNode {
  return {
    id: `${STAGE_NODE_PREFIX}${stage.stageCode}`,
    type: 'stage',
    code: stage.stageCode,
    label: stage.name,
    parentId: stage.parentStageId === null ? null : nodeIdForStage(stageById, String(stage.parentStageId)),
    moduleCode: stage.moduleCode,
    actorType: stage.actorType,
    order: stage.displayOrder,
    isEntry: stage.isEntryStage,
    isExit: stage.isTerminalStage,
    isOptional: stage.isOptional,
    httpMethod: null,
    routePath: null,
    allowedRoles: stage.allowedRoles ?? [],
  };
}

function stepNode(step: WorkflowBundle['steps'][number], stageById: Map<string, WorkflowBundle['stages'][number]>): GraphNode {
  const stage = stageById.get(String(step.workflowStageId));
  return {
    id: `${STEP_NODE_PREFIX}${step.stepCode}`,
    type: 'step',
    code: step.stepCode,
    label: `${step.httpMethod} ${step.routePath}`,
    parentId: stage ? `${STAGE_NODE_PREFIX}${stage.stageCode}` : null,
    moduleCode: stage?.moduleCode ?? '',
    actorType: stage?.actorType ?? null,
    order: step.executionOrder,
    isEntry: step.isFlowEntry,
    isExit: step.isFlowExit,
    isOptional: !step.isMandatory,
    httpMethod: step.httpMethod,
    routePath: step.routePath,
    allowedRoles: step.allowedRoles ?? [],
  };
}

function transitionEdge(
  transition: WorkflowBundle['transitions'][number],
  stepById: Map<string, WorkflowBundle['steps'][number]>,
): GraphEdge {
  return {
    id: `transition:${transition.transitionCode}`,
    type: 'transition',
    source: stepNodeId(stepById, transition.fromStepId),
    target: stepNodeId(stepById, transition.toStepId),
    label: transition.description ?? transition.transitionCode,
    conditionType: transition.conditionType,
    conditionExpression: transition.conditionExpression ?? {},
    isDefaultPath: transition.isDefaultPath,
  };
}

/**
 * Una dependencia cuyos pasos no están en el bundle (filtrado o borrado lógico) NO produce arista:
 * a diferencia de una transición, donde un extremo nulo significa "borde del flujo", aquí un nulo
 * solo significa que el nodo no existe, y dibujarla dejaría una flecha suelta en el diagrama.
 */
function dependencyEdge(
  dependency: WorkflowBundle['dependencies'][number],
  stepById: Map<string, WorkflowBundle['steps'][number]>,
): GraphEdge | null {
  const source = stepNodeId(stepById, dependency.dependsOnStepId);
  const target = stepNodeId(stepById, dependency.stepId);
  if (!source || !target) return null;
  return {
    id: `dependency:${dependency.id}`,
    type: 'dependency',
    source,
    target,
    label: dependency.dependencyType,
    conditionType: null,
    conditionExpression: null,
    isDefaultPath: false,
  };
}

function isEdge(edge: GraphEdge | null): edge is GraphEdge {
  return edge !== null;
}

function nodeIdForStage(stageById: Map<string, WorkflowBundle['stages'][number]>, id: string): string | null {
  const stage = stageById.get(id);
  return stage ? `${STAGE_NODE_PREFIX}${stage.stageCode}` : null;
}

function stepNodeId(stepById: Map<string, WorkflowBundle['steps'][number]>, id: string | null): string | null {
  if (id === null) return null;
  const step = stepById.get(String(id));
  return step ? `${STEP_NODE_PREFIX}${step.stepCode}` : null;
}
