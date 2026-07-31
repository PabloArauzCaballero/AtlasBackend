/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { WorkflowDefinitionModel, WorkflowStageModel, WorkflowStepModel } from '../../database/models/index.js';
import { toIsoOrNull } from '../../common/utils/dates/date.util.js';
import { WorkflowBundle } from './workflow-catalog.repository.js';
import { WorkflowStageDto, WorkflowStepDto, WorkflowSummaryDto, WorkflowTransitionDto, WorkflowTreeDto } from './workflow-catalog.dtos.js';

export function toWorkflowSummary(definition: WorkflowDefinitionModel): WorkflowSummaryDto {
  return {
    workflowId: String(definition.id),
    workflowCode: definition.workflowCode,
    version: definition.version,
    name: definition.name,
    description: definition.description,
    processType: definition.processType,
    ownerDomain: definition.ownerDomain,
    status: definition.status,
    isDefault: definition.isDefault,
    entryStageCode: definition.entryStageCode,
    terminalStageCodes: list(definition.terminalStageCodes),
    source: definition.source,
    effectiveFrom: toIsoOrNull(definition.effectiveFrom),
    effectiveUntil: toIsoOrNull(definition.effectiveUntil),
    createdBy: definition.createdBy,
    updatedBy: definition.updatedBy,
    createdAt: definition.createdAtValue.toISOString(),
    updatedAt: definition.updatedAtValue.toISOString(),
  };
}

type StepEdges = {
  dependsOn: Map<string, Array<{ stepCode: string; dependencyType: string; description: string | null }>>;
  previous: Map<string, string[]>;
  next: Map<string, string[]>;
};

function buildStepEdges(bundle: WorkflowBundle): StepEdges {
  const stepCodeById = new Map(bundle.steps.map((step) => [String(step.id), step.stepCode]));
  const dependsOn = new Map<string, Array<{ stepCode: string; dependencyType: string; description: string | null }>>();
  const previous = new Map<string, string[]>();
  const next = new Map<string, string[]>();

  for (const dependency of bundle.dependencies) {
    const stepCode = stepCodeById.get(String(dependency.stepId));
    const dependsOnCode = stepCodeById.get(String(dependency.dependsOnStepId));
    if (!stepCode || !dependsOnCode) continue;
    const current = dependsOn.get(stepCode) ?? [];
    current.push({ stepCode: dependsOnCode, dependencyType: dependency.dependencyType, description: dependency.description });
    dependsOn.set(stepCode, current);
  }

  for (const transition of bundle.transitions) {
    const fromCode = transition.fromStepId === null ? null : (stepCodeById.get(String(transition.fromStepId)) ?? null);
    const toCode = transition.toStepId === null ? null : (stepCodeById.get(String(transition.toStepId)) ?? null);
    if (fromCode && toCode) {
      next.set(fromCode, [...(next.get(fromCode) ?? []), toCode]);
      previous.set(toCode, [...(previous.get(toCode) ?? []), fromCode]);
    }
  }

  return { dependsOn, previous, next };
}

/**
 * Las columnas JSONB son `NOT NULL DEFAULT` en la base, pero una fila escrita antes de la migración
 * —o un modelo construido en un test— puede traer `null`. Normalizar en un solo helper evita
 * dispersar `?? []` por todo el mapper y que el frontend tenga que defenderse de nulos.
 */
function list<T>(value: T[] | null | undefined): T[] {
  return value ?? [];
}

function record(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value ?? {};
}

function toStep(step: WorkflowStepModel, edges: StepEdges): WorkflowStepDto {
  return {
    stepId: String(step.id),
    stepCode: step.stepCode,
    name: step.name,
    description: step.description,
    endpointCode: step.endpointCode,
    httpMethod: step.httpMethod,
    routePath: step.routePath,
    executionOrder: step.executionOrder,
    isMandatory: step.isMandatory,
    isRepeatable: step.isRepeatable,
    requiresAuth: step.requiresAuth,
    requiresIdempotencyKey: step.requiresIdempotencyKey,
    isFlowEntry: step.isFlowEntry,
    isFlowExit: step.isFlowExit,
    allowedRoles: list(step.allowedRoles),
    requiredStates: list(step.requiredStates),
    resultingStates: list(step.resultingStates),
    inputContract: record(step.inputContract),
    outputContract: record(step.outputContract),
    validationRules: list(step.validationRules),
    possibleErrors: list(step.possibleErrors),
    retryStrategy: record(step.retryStrategy),
    producesEvents: list(step.producesEvents),
    consumesEvents: list(step.consumesEvents),
    successCriteria: record(step.successCriteria),
    failureCriteria: record(step.failureCriteria),
    dependsOn: list(edges.dependsOn.get(step.stepCode)),
    previousStepCodes: list(edges.previous.get(step.stepCode)),
    nextStepCodes: list(edges.next.get(step.stepCode)),
  };
}

function toStage(stage: WorkflowStageModel, stageCodeById: Map<string, string>, steps: WorkflowStepDto[]): WorkflowStageDto {
  return {
    stageId: String(stage.id),
    stageCode: stage.stageCode,
    parentStageCode: stage.parentStageId === null ? null : (stageCodeById.get(String(stage.parentStageId)) ?? null),
    name: stage.name,
    description: stage.description,
    moduleCode: stage.moduleCode,
    actorType: stage.actorType,
    displayOrder: stage.displayOrder,
    isOptional: stage.isOptional,
    isEntryStage: stage.isEntryStage,
    isTerminalStage: stage.isTerminalStage,
    allowedRoles: list(stage.allowedRoles),
    requiredStates: list(stage.requiredStates),
    resultingStates: list(stage.resultingStates),
    completionRule: record(stage.completionRule),
    steps,
    subStages: [],
  };
}

export function toWorkflowTransition(
  transition: WorkflowBundle['transitions'][number],
  stepCodeById: Map<string, string>,
): WorkflowTransitionDto {
  return {
    transitionId: String(transition.id),
    transitionCode: transition.transitionCode,
    fromStepCode: transition.fromStepId === null ? null : (stepCodeById.get(String(transition.fromStepId)) ?? null),
    toStepCode: transition.toStepId === null ? null : (stepCodeById.get(String(transition.toStepId)) ?? null),
    conditionType: transition.conditionType,
    conditionExpression: record(transition.conditionExpression),
    description: transition.description,
    displayOrder: transition.displayOrder,
    isDefaultPath: transition.isDefaultPath,
  };
}

/**
 * Arma el árbol: etapas raíz con sus subetapas anidadas y cada paso en la suya.
 *
 * El anidamiento se resuelve en una sola pasada sobre estructuras indexadas. Una etapa cuyo padre
 * fue filtrado (o borrado lógicamente) sube a raíz en vez de desaparecer: perder una rama entera
 * porque su padre no pasó un filtro daría una respuesta silenciosamente incompleta.
 */
export function toWorkflowTree(bundle: WorkflowBundle): WorkflowTreeDto {
  const edges = buildStepEdges(bundle);
  const stageCodeById = new Map(bundle.stages.map((stage) => [String(stage.id), stage.stageCode]));
  const stepCodeById = new Map(bundle.steps.map((step) => [String(step.id), step.stepCode]));

  const stepsByStage = new Map<string, WorkflowStepDto[]>();
  for (const step of [...bundle.steps].sort((a, b) => a.executionOrder - b.executionOrder)) {
    const key = String(step.workflowStageId);
    stepsByStage.set(key, [...(stepsByStage.get(key) ?? []), toStep(step, edges)]);
  }

  const dtoById = new Map<string, WorkflowStageDto>();
  for (const stage of bundle.stages) {
    dtoById.set(String(stage.id), toStage(stage, stageCodeById, stepsByStage.get(String(stage.id)) ?? []));
  }

  const roots: WorkflowStageDto[] = [];
  for (const stage of bundle.stages) {
    const dto = dtoById.get(String(stage.id));
    if (!dto) continue;
    const parent = stage.parentStageId === null ? undefined : dtoById.get(String(stage.parentStageId));
    if (parent) parent.subStages.push(dto);
    else roots.push(dto);
  }

  const byOrder = (a: WorkflowStageDto, b: WorkflowStageDto) => a.displayOrder - b.displayOrder;
  roots.sort(byOrder);
  for (const dto of dtoById.values()) dto.subStages.sort(byOrder);

  return {
    ...toWorkflowSummary(bundle.definition),
    successCriteria: record(bundle.definition.successCriteria),
    failureCriteria: record(bundle.definition.failureCriteria),
    metadata: record(bundle.definition.metadata),
    stages: roots,
    transitions: bundle.transitions.map((transition) => toWorkflowTransition(transition, stepCodeById)),
    totals: {
      stages: bundle.stages.length,
      steps: bundle.steps.length,
      transitions: bundle.transitions.length,
      dependencies: bundle.dependencies.length,
    },
  };
}
