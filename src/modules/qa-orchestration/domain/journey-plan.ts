/**
 * @file Utilidad pura del dominio: compila y congela el plan de una corrida QA (preflight).
 * @business Esta pieza dice ANTES de gastar una sola petición si la corrida puede ejecutarse, con
 *   qué límites efectivos, y por qué no cuando no puede.
 * @system valida entrada, grafo, bindings, actores, entorno y presupuesto; devuelve bloqueos
 *   accionables y un `planHash` que detecta cualquier cambio posterior.
 */
import { createHash } from 'node:crypto';
import { ASSERTION_KINDS, type Assertion, type JourneyTemplate, type RecipeStep } from './journey-recipe.types.js';
import type { QaBlocker, QaEnvironmentPolicy, QaRunLimits, QaRunRequest } from './qa-run.types.js';
import { conditionPaths, referencedPaths } from './typed-bindings.js';

/** Campos de persona disponibles para bindings. Mantener en sincronía con `personaScope`. */
export const PERSONA_FIELDS = [
  'ordinal',
  'personaKey',
  'firstName',
  'lastName',
  'birthDate',
  'age',
  'documentNumber',
  'email',
  'phone',
  'city',
  'department',
  'monthlyIncome',
  'requestedAmount',
  'pin',
  'deviceFingerprintHash',
  'archetype',
  'caseCategory',
] as const;

/** Lo que cada fixture deja en `fixtures.*`. */
export const FIXTURE_OUTPUTS: Record<JourneyTemplate['fixtures'][number], string[]> = {
  consents: ['signupConsents'],
  creditProduct: ['creditProductId'],
  internalActor: ['internalActor'],
  merchantActor: ['merchantActor'],
};

const RUN_FIELDS = ['runId', 'namespace', 'seed', 'referenceDate'];

export type RuntimeReadiness = {
  workerReady: boolean;
  mockReachable: boolean;
  /** Escenarios que el mock declara por proveedor; `null` = no se pudo consultar. */
  mockScenarios: Record<string, string[]> | null;
  availableActors: Array<'internal_user' | 'merchant_user'>;
};

export type EffectivePlan = {
  templateCode: string;
  templateVersion: string;
  recipeHash: string;
  environmentId: string;
  mode: QaRunRequest['mode'];
  persons: number;
  concurrency: number;
  seed: string;
  datasetMode: QaRunRequest['datasetMode'];
  scenarioCode: string;
  limits: QaRunLimits;
  generatorVersion: string;
  estimatedRequests: number;
  estimatedAdmissionMs: number;
  stepCount: number;
  providers: string[];
};

export type PlanResult = { status: 'READY' | 'BLOCKED'; blockers: QaBlocker[]; plan: EffectivePlan | null; planHash: string | null };

function positiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function dependenciesOf(steps: RecipeStep[], index: number): string[] {
  const step = steps[index];
  if (step.dependsOn) return step.dependsOn;
  return index === 0 ? [] : [steps[index - 1].stepKey];
}

function assertionPaths(assertion: Assertion): string[] {
  if (assertion.kind === 'errorCode') return [];
  const own: string[] = [];
  if ('expected' in assertion) own.push(...referencedPaths(assertion.expected));
  if (assertion.kind === 'sameAs') own.push(assertion.ref);
  return own;
}

/** Valida el grafo y que cada referencia tenga un productor ANTERIOR en su cadena de dependencias. */
export function validateRecipe(template: JourneyTemplate): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  const steps = template.steps;
  const index = new Map<string, number>();
  const fixtures = new Set(template.fixtures.flatMap((fixture) => FIXTURE_OUTPUTS[fixture].map((name) => `fixtures.${name}`)));
  const produces = new Map<string, Set<string>>();

  steps.forEach((step, position) => {
    if (index.has(step.stepKey)) blockers.push({ code: 'GRAPH_INVALID', message: `stepKey duplicado: ${step.stepKey}`, subject: step.stepKey });
    index.set(step.stepKey, position);
    produces.set(step.stepKey, new Set((step.extract ?? []).map((extraction) => extraction.to)));
  });

  // Un productor válido es un ANCESTRO: lo que produjo una rama que no precede a este paso no existe aún.
  const ancestors = (position: number, seen = new Set<string>()): Set<string> => {
    for (const dependency of dependenciesOf(steps, position)) {
      const at = index.get(dependency);
      if (at === undefined || at >= position || seen.has(dependency)) continue;
      seen.add(dependency);
      ancestors(at, seen);
    }
    return seen;
  };

  steps.forEach((step, position) => {
    for (const dependency of dependenciesOf(steps, position)) {
      const at = index.get(dependency);
      if (at === undefined) blockers.push({ code: 'GRAPH_INVALID', message: `${step.stepKey} depende de ${dependency}, que no existe`, subject: step.stepKey });
      else if (at >= position) blockers.push({ code: 'GRAPH_INVALID', message: `${step.stepKey} depende de ${dependency}, posterior o cíclico`, subject: step.stepKey });
    }
    if (step.retry && step.retry.maxAttempts > 1 && step.method !== 'GET' && step.idempotency !== 'per_operation') {
      blockers.push({ code: 'GRAPH_INVALID', message: `${step.stepKey} reintenta una escritura sin idempotencia declarada`, subject: step.stepKey });
    }
    for (const assertion of [...(step.expect.assertions ?? []), ...(step.branches ?? []).flatMap((branch) => branch.assertions ?? [])]) {
      if (!(ASSERTION_KINDS as readonly string[]).includes(assertion.kind)) {
        blockers.push({ code: 'CONTRACT_MISMATCH', message: `${step.stepKey} usa una aserción desconocida: ${assertion.kind}`, subject: step.stepKey });
      }
    }

    const available = new Set<string>(fixtures);
    for (const ancestor of ancestors(position)) for (const produced of produces.get(ancestor) ?? []) available.add(produced);
    const needed = [
      ...referencedPaths(step.path),
      ...referencedPaths(step.body),
      ...Object.values(step.query ?? {}).flatMap((binding) => referencedPaths(binding)),
      ...(step.applicability ? conditionPaths(step.applicability.when) : []),
      ...(step.branches ?? []).flatMap((branch) => conditionPaths(branch.when)),
      ...[...(step.expect.assertions ?? []), ...(step.branches ?? []).flatMap((branch) => branch.assertions ?? [])].flatMap(assertionPaths),
    ];
    for (const path of needed) {
      const [root, field] = path.split('.');
      const resolvable =
        (root === 'persona' && (PERSONA_FIELDS as readonly string[]).includes(field)) ||
        (root === 'run' && RUN_FIELDS.includes(field)) ||
        root === 'response' ||
        available.has(path) ||
        // Condicionar sobre un recurso opcional es legítimo si ALGÚN ancestro lo intenta extraer.
        [...available].some((candidate) => path.startsWith(`${candidate}.`));
      if (!resolvable) blockers.push({ code: 'BINDING_UNRESOLVED', message: `${step.stepKey} necesita ${path} y ningún paso anterior lo produce`, subject: step.stepKey });
    }
  });
  return blockers;
}

export function hashPlan(plan: EffectivePlan): string {
  const ordered = Object.fromEntries(Object.entries(plan).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export function compilePlan(input: {
  request: QaRunRequest;
  template: JourneyTemplate | undefined;
  recipeHash: string | null;
  environment: QaEnvironmentPolicy | undefined;
  readiness: RuntimeReadiness;
  generatorVersion: string;
}): PlanResult {
  const { request, template, environment, readiness } = input;
  const blockers: QaBlocker[] = [];
  const blocked = (): PlanResult => ({ status: 'BLOCKED', blockers, plan: null, planHash: null });

  if (!positiveInteger(request.persons)) blockers.push({ code: 'INVALID_INPUT', message: 'Personas tiene que ser un entero mayor que cero.', subject: 'persons' });
  if (!positiveInteger(request.concurrency)) blockers.push({ code: 'INVALID_INPUT', message: 'Concurrencia tiene que ser un entero mayor que cero.', subject: 'concurrency' });
  if (!environment) {
    blockers.push({ code: 'UNSAFE_ENVIRONMENT', message: `El entorno ${request.environmentId} no está registrado para QA.`, subject: 'environmentId' });
    return blocked();
  }
  if (environment.deploymentEnvironment === 'PROD') {
    blockers.push({ code: 'UNSAFE_ENVIRONMENT', message: 'Producción no admite corridas QA ni contexto de mock.', subject: 'environmentId' });
  }
  if (!template) {
    blockers.push({ code: 'TEMPLATE_NOT_READY', message: `No existe la plantilla ${request.templateCode}@${request.templateVersion}.` });
    return blocked();
  }
  if (template.status !== 'READY') {
    blockers.push({ code: 'TEMPLATE_NOT_READY', message: `La plantilla está ${template.status}: ${(template.blockedReasons ?? []).join('; ') || 'sin validar'}.` });
  }
  if (blockers.some((blocker) => blocker.code === 'INVALID_INPUT')) return blocked();

  if (request.persons > environment.maxPersons) {
    blockers.push({ code: 'BUDGET_EXCEEDED', message: `El entorno admite hasta ${environment.maxPersons} personas; se pidieron ${request.persons}.`, subject: 'persons' });
  }
  if (request.concurrency > environment.maxConcurrency) {
    blockers.push({ code: 'BUDGET_EXCEEDED', message: `El entorno admite hasta ${environment.maxConcurrency} personas simultáneas.`, subject: 'concurrency' });
  }
  if (request.concurrency > request.persons) {
    blockers.push({ code: 'INVALID_INPUT', message: 'La concurrencia no puede superar al total de personas.', subject: 'concurrency' });
  }
  const limits: QaRunLimits = { ...environment.limits };
  for (const key of Object.keys(limits) as Array<keyof QaRunLimits>) {
    const requested = request.limits?.[key];
    if (requested === undefined) continue;
    if (!positiveInteger(requested)) blockers.push({ code: 'INVALID_INPUT', message: `${key} tiene que ser un entero positivo.`, subject: key });
    else if (requested > environment.limits[key]) blockers.push({ code: 'BUDGET_EXCEEDED', message: `${key} supera el tope del entorno (${environment.limits[key]}).`, subject: key });
    else limits[key] = requested;
  }

  if (!template.scenarios.includes(request.scenarioCode)) {
    blockers.push({ code: 'SCENARIO_UNSUPPORTED', message: `La plantilla no interpreta el escenario ${request.scenarioCode}.`, subject: request.scenarioCode });
  }
  if (!template.datasetModes.includes(request.datasetMode)) {
    blockers.push({ code: 'INVALID_INPUT', message: `La plantilla no admite datos ${request.datasetMode}.`, subject: 'datasetMode' });
  }
  blockers.push(...validateRecipe(template));

  for (const actor of template.actors) {
    if ((actor === 'internal_user' || actor === 'merchant_user') && !readiness.availableActors.includes(actor)) {
      blockers.push({ code: 'ACTOR_UNAVAILABLE', message: `No hay un actor ${actor} provisionado para QA en este entorno.`, subject: actor });
    }
  }
  if (!readiness.workerReady) blockers.push({ code: 'WORKER_UNAVAILABLE', message: 'No hay un worker QA disponible. No se ha iniciado ninguna persona.' });

  const providers = [...new Set(template.steps.flatMap((step) => (step.providers ?? []).map((provider) => provider.provider)))].sort();
  if (providers.length > 0 && request.mode === 'INTEGRATED_QA') {
    if (!readiness.mockReachable) blockers.push({ code: 'MOCK_UNAVAILABLE', message: 'El mock de proveedores no responde; la evidencia externa no podría comprobarse.' });
    for (const provider of providers) {
      const supported = readiness.mockScenarios?.[provider];
      if (readiness.mockScenarios && (!supported || !supported.includes(request.scenarioCode))) {
        blockers.push({ code: 'SCENARIO_UNSUPPORTED', message: `El proveedor ${provider} no admite el escenario ${request.scenarioCode}.`, subject: provider });
      }
    }
  }

  const attemptsPerStep = template.steps.map((step) => Math.max(1, step.retry?.maxAttempts ?? 1) + (step.poll ? Math.ceil(step.poll.deadlineMs / step.poll.intervalMs) : 0));
  const estimatedRequests = request.persons * attemptsPerStep.reduce((sum, value) => sum + value, 0);
  if (estimatedRequests > limits.maxRequests) {
    blockers.push({ code: 'BUDGET_EXCEEDED', message: `El recorrido puede emitir hasta ${estimatedRequests} solicitudes y el presupuesto es ${limits.maxRequests}.`, subject: 'maxRequests' });
  }
  // El cupo más restrictivo manda: N altas a 10/min tardan N/10 minutos antes de cualquier otro paso.
  const slowest = Math.min(...template.steps.map((step) => step.rateLimit?.perMinute ?? Number.POSITIVE_INFINITY));
  const estimatedAdmissionMs = Number.isFinite(slowest) ? Math.max(0, Math.ceil(request.persons / slowest) - 1) * 60_000 : 0;
  if (estimatedAdmissionMs > limits.maxDurationMs) {
    blockers.push({ code: 'BUDGET_EXCEEDED', message: `Sólo la admisión limitada por tasa tardaría ~${Math.round(estimatedAdmissionMs / 60_000)} min; el tope es ${Math.round(limits.maxDurationMs / 60_000)} min.`, subject: 'maxDurationMs' });
  }

  if (blockers.length > 0) return blocked();
  const plan: EffectivePlan = {
    templateCode: template.code,
    templateVersion: template.version,
    recipeHash: input.recipeHash ?? '',
    environmentId: environment.environmentId,
    mode: request.mode,
    persons: request.persons,
    concurrency: request.concurrency,
    seed: request.seed,
    datasetMode: request.datasetMode,
    scenarioCode: request.scenarioCode,
    limits,
    generatorVersion: input.generatorVersion,
    estimatedRequests,
    estimatedAdmissionMs,
    stepCount: template.steps.length,
    providers,
  };
  return { status: 'READY', blockers: [], plan, planHash: hashPlan(plan) };
}
