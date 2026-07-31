/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { WorkflowProgressStatus } from './workflow-catalog.constants.js';

export type WorkflowStepDto = {
  stepId: string;
  stepCode: string;
  name: string;
  description: string | null;
  endpointCode: string;
  httpMethod: string;
  routePath: string;
  executionOrder: number;
  isMandatory: boolean;
  isRepeatable: boolean;
  requiresAuth: boolean;
  requiresIdempotencyKey: boolean;
  isFlowEntry: boolean;
  isFlowExit: boolean;
  allowedRoles: string[];
  requiredStates: string[];
  resultingStates: string[];
  inputContract: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  validationRules: unknown[];
  possibleErrors: unknown[];
  retryStrategy: Record<string, unknown>;
  producesEvents: string[];
  consumesEvents: string[];
  successCriteria: Record<string, unknown>;
  failureCriteria: Record<string, unknown>;
  dependsOn: Array<{ stepCode: string; dependencyType: string; description: string | null }>;
  previousStepCodes: string[];
  nextStepCodes: string[];
};

export type WorkflowStageDto = {
  stageId: string;
  stageCode: string;
  parentStageCode: string | null;
  name: string;
  description: string | null;
  moduleCode: string;
  actorType: string;
  displayOrder: number;
  isOptional: boolean;
  isEntryStage: boolean;
  isTerminalStage: boolean;
  allowedRoles: string[];
  requiredStates: string[];
  resultingStates: string[];
  completionRule: Record<string, unknown>;
  steps: WorkflowStepDto[];
  subStages: WorkflowStageDto[];
};

export type WorkflowTransitionDto = {
  transitionId: string;
  transitionCode: string;
  fromStepCode: string | null;
  toStepCode: string | null;
  conditionType: string;
  conditionExpression: Record<string, unknown>;
  description: string | null;
  displayOrder: number;
  isDefaultPath: boolean;
};

export type WorkflowSummaryDto = {
  workflowId: string;
  workflowCode: string;
  version: string;
  name: string;
  description: string | null;
  processType: string;
  ownerDomain: string;
  status: string;
  isDefault: boolean;
  entryStageCode: string | null;
  terminalStageCodes: string[];
  source: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTreeDto = WorkflowSummaryDto & {
  successCriteria: Record<string, unknown>;
  failureCriteria: Record<string, unknown>;
  metadata: Record<string, unknown>;
  stages: WorkflowStageDto[];
  transitions: WorkflowTransitionDto[];
  totals: { stages: number; steps: number; transitions: number; dependencies: number };
};

/** Proyección plana para dibujar el flujo. El frontend no recorre el árbol para pintar aristas. */
export type WorkflowGraphDto = {
  workflowCode: string;
  version: string;
  status: string;
  nodes: Array<{
    id: string;
    type: 'stage' | 'step';
    code: string;
    label: string;
    parentId: string | null;
    moduleCode: string;
    actorType: string | null;
    order: number;
    isEntry: boolean;
    isExit: boolean;
    isOptional: boolean;
    httpMethod: string | null;
    routePath: string | null;
    allowedRoles: string[];
  }>;
  edges: Array<{
    id: string;
    type: 'transition' | 'dependency';
    source: string | null;
    target: string | null;
    label: string;
    conditionType: string | null;
    conditionExpression: Record<string, unknown> | null;
    isDefaultPath: boolean;
  }>;
};

export type WorkflowStageProgressDto = {
  stageCode: string;
  name: string;
  moduleCode: string;
  actorType: string;
  displayOrder: number;
  isOptional: boolean;
  status: WorkflowProgressStatus;
  reason: string | null;
  steps: Array<{ stepCode: string; httpMethod: string; routePath: string; isMandatory: boolean; status: WorkflowProgressStatus }>;
};

export type WorkflowProgressDto = {
  workflowCode: string;
  version: string;
  customerId: string;
  lifecycleStatus: string;
  eligible: boolean;
  completionPercentage: number;
  currentStageCode: string | null;
  nextStep: {
    stageCode: string;
    stepCode: string;
    httpMethod: string;
    routePath: string;
    allowedRoles: string[];
  } | null;
  completedStageCodes: string[];
  pendingStageCodes: string[];
  blockedStageCodes: string[];
  blockers: Array<{ code: string; fields?: string[]; detail?: string }>;
  stages: WorkflowStageProgressDto[];
  evaluatedAt: string;
};

export type WorkflowTransitionCheckDto = {
  workflowCode: string;
  version: string;
  fromStepCode: string | null;
  toStepCode: string;
  allowed: boolean;
  reasonCode:
    | 'TRANSITION_DECLARED'
    | 'TRANSITION_NOT_DECLARED'
    | 'STEP_NOT_FOUND'
    | 'UNSATISFIED_DEPENDENCIES'
    | 'ROLE_NOT_AUTHORIZED'
    | 'STATE_NOT_ALLOWED';
  message: string;
  transition: WorkflowTransitionDto | null;
  unsatisfiedDependencies: string[];
  requiredStates: string[];
  allowedRoles: string[];
};

export type WorkflowConsistencyDto = {
  workflowCode: string;
  version: string;
  checkedAt: string;
  exposedRouteCount: number;
  stepCount: number;
  status: 'in_sync' | 'drift_detected';
  issues: Array<{
    severity: 'error' | 'warning';
    code:
      | 'STEP_ROUTE_NOT_EXPOSED'
      | 'STEP_ENDPOINT_CODE_MISMATCH'
      | 'STEP_ROLES_DIVERGED'
      | 'STEP_NOT_IN_ENDPOINT_CATALOG'
      | 'STEP_UNKNOWN_LIFECYCLE_STATE'
      | 'ROUTE_NOT_MAPPED';
    stepCode: string | null;
    detail: string;
  }>;
};
