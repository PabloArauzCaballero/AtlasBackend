/**
 * @file Mapeo puro: de una fixture de proceso a los parámetros de cada sentencia del volcado.
 * @business Esta pieza fija qué significa cada valor por omisión de un proceso (un paso es HTTP y obligatorio si no dice otra cosa) en un solo sitio.
 * @system funciones sin E/S que usa `syncWorkflowCatalog`; los valores por omisión se aplican con objetos, no con ramas.
 */
import type {
  ProcessDependencyFixture,
  ProcessStageFixture,
  ProcessStepFixture,
  ProcessTransitionFixture,
  WorkflowDefinitionFixture,
} from './workflow-definition.types.js';

/** El mismo algoritmo que `buildEndpointCode`, para que el paso y el catálogo de endpoints crucen por construcción. */
export function endpointCodeFor(method: string, path: string): string {
  const normalizado = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/:([A-Za-z0-9_]+)/g, 'by_$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return `${method.toUpperCase()}_${normalizado || 'ROOT'}`.slice(0, 180);
}

/** Código lógico de un paso que no es HTTP: `EVENT_…`, `JOB_…`, `MANUAL_…`, `EXTERNAL_…`. */
export function stepEndpointCode(step: ProcessStepFixture): string {
  const kind = step.kind ?? 'http';
  if (kind === 'http') return endpointCodeFor(step.method ?? 'GET', step.path ?? '/');
  const base = (step.job ?? step.code).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return `${kind.toUpperCase()}_${base}`.slice(0, 180);
}

export type StepRef = { stage: ProcessStageFixture; step: ProcessStepFixture; stageIndex: number; stepIndex: number };

const STAGE_DEFAULTS = {
  optional: false,
  entry: false,
  terminal: false,
  roles: [],
  requiredStates: [],
  resultingStates: [],
  completionRule: { type: 'manual' },
};
const STEP_DEFAULTS = {
  kind: 'http',
  system: 'ATLAS_BACKEND',
  optional: false,
  repeatable: false,
  idempotencyKey: false,
  requiredStates: [],
  resultingStates: [],
  input: {},
  output: {},
  errors: [],
  events: [],
  consumes: [],
};
const RETRY_WITH_KEY = { strategy: 'client_retry_with_idempotency_key', maxAttempts: 3, backoff: 'exponential' };

export function flattenSteps(fixture: WorkflowDefinitionFixture): StepRef[] {
  return fixture.stages.flatMap((stage, stageIndex) => stage.steps.map((step, stepIndex) => ({ stage, step, stageIndex, stepIndex })));
}

export function definitionReplacements(fixture: WorkflowDefinitionFixture, appliedBy: string, now: string): Record<string, unknown> {
  const entry = fixture.stages.find((s) => s.entry) ?? fixture.stages[0];
  return {
    code: fixture.code,
    version: fixture.version,
    name: fixture.name,
    description: fixture.description,
    processType: fixture.processType,
    ownerDomain: fixture.ownerDomain,
    entry: entry?.code ?? null,
    terminals: JSON.stringify(fixture.stages.filter((s) => s.terminal).map((s) => s.code)),
    success: JSON.stringify({ description: fixture.success }),
    failure: JSON.stringify({ description: fixture.failure }),
    metadata: JSON.stringify({ documentation: `docs/processes/${fixture.code}.md`, sources: fixture.sources, ...fixture.metadata }),
    appliedBy,
    narrative: JSON.stringify(fixture.narrative),
    ownerRole: fixture.ownerRole,
    priority: fixture.priority,
    processId: fixture.processId,
    instance: JSON.stringify({ ...fixture.instanceEntity }),
    systems: JSON.stringify(fixture.systems),
    now,
  };
}

export function stageReplacements(
  stage: ProcessStageFixture,
  index: number,
  definitionId: string,
  parentId: string | null,
  now: string,
): Record<string, unknown> {
  const s = { ...STAGE_DEFAULTS, screen: null, link: null, ...stage };
  return {
    definitionId,
    parentId,
    code: s.code,
    name: s.name,
    description: s.description,
    module: s.module,
    actor: s.actor,
    order: (index + 1) * 10,
    optional: s.optional,
    entry: s.entry,
    terminal: s.terminal,
    roles: JSON.stringify(s.roles),
    required: JSON.stringify(s.requiredStates),
    resulting: JSON.stringify(s.resultingStates),
    completion: JSON.stringify(s.completionRule),
    client: s.client,
    screen: s.screen,
    link: s.link,
    now,
  };
}

export function stepReplacements(
  ref: StepRef,
  at: { position: number; total: number; definitionId: string; stageId: string; now: string },
): Record<string, unknown> {
  const p = { ...STEP_DEFAULTS, roles: ref.stage.roles ?? [], job: null, ...ref.step };
  const http = p.kind === 'http';
  return {
    definitionId: at.definitionId,
    stageId: at.stageId,
    code: p.code,
    name: p.name,
    description: p.description,
    endpointCode: stepEndpointCode(ref.step),
    method: http ? String(p.method ?? 'GET').toUpperCase() : null,
    path: http ? (p.path ?? '/') : null,
    order: (ref.stageIndex + 1) * 1000 + (ref.stepIndex + 1) * 10,
    mandatory: !p.optional,
    repeatable: p.repeatable,
    idempotency: p.idempotencyKey,
    auth: p.auth ?? http,
    entry: at.position === 0,
    exit: at.position === at.total - 1,
    roles: JSON.stringify(p.roles),
    required: JSON.stringify(p.requiredStates),
    resulting: JSON.stringify(p.resultingStates),
    input: JSON.stringify(p.input),
    output: JSON.stringify(p.output),
    errors: JSON.stringify(p.errors),
    retry: JSON.stringify(p.idempotencyKey ? RETRY_WITH_KEY : {}),
    events: JSON.stringify(p.events),
    consumes: JSON.stringify(p.consumes),
    success: JSON.stringify({ statusCodes: p.successStatus ?? (http ? [200] : []) }),
    metadata: JSON.stringify(p.reason ? { reason: p.reason } : {}),
    system: p.system,
    kind: p.kind,
    job: p.job,
    now: at.now,
  };
}

/** Las declaradas o, si la fixture no trae, cada paso depende del anterior. */
export function dependenciesOf(fixture: WorkflowDefinitionFixture): ProcessDependencyFixture[] {
  if (fixture.dependencies) return fixture.dependencies;
  const all = flattenSteps(fixture);
  return all.slice(1).map(({ step }, i) => ({
    step: step.code,
    dependsOn: all[i]!.step.code,
    type: step.optional ? 'soft' : 'requires_completion',
    description: `${step.code} necesita que ${all[i]!.step.code} haya terminado.`,
  }));
}

export function transitionReplacements(t: ProcessTransitionFixture, index: number, id: (code: string) => string): Record<string, unknown> {
  const x = { expression: {}, description: null, order: index + 1, isDefault: false, ...t };
  return {
    code: x.code,
    from: x.from ? id(x.from) : null,
    to: x.to ? id(x.to) : null,
    condition: x.condition,
    expression: JSON.stringify(x.expression),
    description: x.description,
    order: x.order,
    isDefault: x.isDefault,
  };
}
