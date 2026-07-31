import type {
  WorkflowDefinitionModel,
  WorkflowStageModel,
  WorkflowStepDependencyModel,
  WorkflowStepModel,
  WorkflowTransitionModel,
} from '../../../src/database/models/index.js';
import type { WorkflowBundle } from '../../../src/modules/workflow-catalog/workflow-catalog.repository.js';

/**
 * Constructores de un bundle de flujo en memoria.
 *
 * Los modelos Sequelize se simulan con objetos planos: los servicios del módulo solo leen
 * propiedades, nunca invocan métodos de instancia, así que un `as unknown as Model` mantiene los
 * tests sin base de datos sin ocultar ninguna dependencia real.
 */

const NOW = new Date('2026-07-28T00:00:00.000Z');

export function buildDefinition(overrides: Partial<WorkflowDefinitionModel> = {}): WorkflowDefinitionModel {
  return {
    id: '1',
    workflowCode: 'demo_flow',
    version: 'v1',
    name: 'Flujo de prueba',
    description: null,
    processType: 'customer_journey',
    ownerDomain: 'customer_lifecycle',
    status: 'active',
    isDefault: true,
    entryStageCode: 'stage_a',
    terminalStageCodes: ['stage_b'],
    successCriteria: {},
    failureCriteria: {},
    metadata: {},
    source: 'seed',
    effectiveFrom: null,
    effectiveUntil: null,
    createdBy: 'seed',
    updatedBy: 'seed',
    createdAtValue: NOW,
    updatedAtValue: NOW,
    deleted: false,
    ...overrides,
  } as unknown as WorkflowDefinitionModel;
}

export function buildStage(overrides: Partial<WorkflowStageModel> & { id: string; stageCode: string }): WorkflowStageModel {
  return {
    workflowDefinitionId: '1',
    parentStageId: null,
    name: `Etapa ${overrides.stageCode}`,
    description: null,
    moduleCode: 'customer_onboarding',
    actorType: 'customer',
    displayOrder: 10,
    isOptional: false,
    isEntryStage: false,
    isTerminalStage: false,
    allowedRoles: [],
    requiredStates: [],
    resultingStates: [],
    completionRule: {},
    metadata: {},
    createdAtValue: NOW,
    updatedAtValue: NOW,
    deleted: false,
    ...overrides,
  } as unknown as WorkflowStageModel;
}

export function buildStep(overrides: Partial<WorkflowStepModel> & { id: string; stepCode: string }): WorkflowStepModel {
  return {
    workflowDefinitionId: '1',
    workflowStageId: '10',
    name: `Paso ${overrides.stepCode}`,
    description: null,
    endpointCode: 'GET_DEMO',
    httpMethod: 'GET',
    routePath: '/demo',
    executionOrder: 10,
    isMandatory: true,
    isRepeatable: false,
    requiresIdempotencyKey: false,
    requiresAuth: true,
    isFlowEntry: false,
    isFlowExit: false,
    allowedRoles: [],
    requiredStates: [],
    resultingStates: [],
    inputContract: {},
    outputContract: {},
    validationRules: [],
    possibleErrors: [],
    retryStrategy: {},
    producesEvents: [],
    consumesEvents: [],
    successCriteria: {},
    failureCriteria: {},
    metadata: {},
    createdAtValue: NOW,
    updatedAtValue: NOW,
    deleted: false,
    ...overrides,
  } as unknown as WorkflowStepModel;
}

export function buildDependency(
  overrides: Partial<WorkflowStepDependencyModel> & { id: string; stepId: string; dependsOnStepId: string },
): WorkflowStepDependencyModel {
  return {
    workflowDefinitionId: '1',
    dependencyType: 'requires_completion',
    description: null,
    createdAtValue: NOW,
    updatedAtValue: NOW,
    ...overrides,
  } as unknown as WorkflowStepDependencyModel;
}

export function buildTransition(
  overrides: Partial<WorkflowTransitionModel> & { id: string; transitionCode: string },
): WorkflowTransitionModel {
  return {
    workflowDefinitionId: '1',
    fromStepId: null,
    toStepId: null,
    conditionType: 'on_success',
    conditionExpression: {},
    description: null,
    displayOrder: 10,
    isDefaultPath: false,
    createdAtValue: NOW,
    updatedAtValue: NOW,
    ...overrides,
  } as unknown as WorkflowTransitionModel;
}

/**
 * Bundle mínimo pero representativo: una etapa raíz con una subetapa, tres pasos encadenados por
 * transiciones y una dependencia obligatoria. Cubre jerarquía, aristas y filtros a la vez.
 */
export function buildBundle(): WorkflowBundle {
  const stages = [
    buildStage({ id: '10', stageCode: 'stage_a', displayOrder: 10, isEntryStage: true, moduleCode: 'auth', allowedRoles: ['customer'] }),
    buildStage({ id: '11', stageCode: 'stage_a_child', displayOrder: 20, parentStageId: '10', moduleCode: 'customer_onboarding' }),
    buildStage({
      id: '12',
      stageCode: 'stage_b',
      displayOrder: 30,
      isTerminalStage: true,
      moduleCode: 'operations',
      actorType: 'internal_user',
      requiredStates: ['under_review'],
      allowedRoles: ['internal_operator'],
    }),
  ];
  const steps = [
    buildStep({
      id: '100',
      stepCode: 'step.one',
      workflowStageId: '10',
      executionOrder: 10,
      httpMethod: 'POST',
      routePath: '/auth/login',
      endpointCode: 'POST_AUTH_LOGIN',
      isFlowEntry: true,
      allowedRoles: [],
    }),
    buildStep({
      id: '101',
      stepCode: 'step.two',
      workflowStageId: '11',
      executionOrder: 20,
      httpMethod: 'PATCH',
      routePath: '/customer-onboarding/:customerId/profile',
      endpointCode: 'PATCH_CUSTOMER_ONBOARDING_BY_CUSTOMERID_PROFILE',
      allowedRoles: ['customer'],
    }),
    buildStep({
      id: '102',
      stepCode: 'step.three',
      workflowStageId: '12',
      executionOrder: 30,
      httpMethod: 'GET',
      routePath: '/operations/work-queue',
      endpointCode: 'GET_OPERATIONS_WORK_QUEUE',
      isFlowExit: true,
      allowedRoles: ['internal_operator'],
      requiredStates: ['under_review'],
    }),
  ];
  return {
    definition: buildDefinition(),
    stages,
    steps,
    dependencies: [buildDependency({ id: '200', stepId: '102', dependsOnStepId: '101' })],
    transitions: [
      buildTransition({ id: '300', transitionCode: 'entry', fromStepId: null, toStepId: '100', conditionType: 'always' }),
      buildTransition({ id: '301', transitionCode: 'one_to_two', fromStepId: '100', toStepId: '101', isDefaultPath: true }),
      buildTransition({ id: '302', transitionCode: 'two_to_three', fromStepId: '101', toStepId: '102' }),
      buildTransition({ id: '303', transitionCode: 'exit', fromStepId: '102', toStepId: null, conditionType: 'always' }),
    ],
  };
}
