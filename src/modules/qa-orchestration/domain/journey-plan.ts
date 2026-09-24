/**
 * @file Utilidad pura del dominio: compila y congela el plan de una corrida QA (preflight).
 * @business Esta pieza dice ANTES de gastar una sola petición si la corrida puede ejecutarse, con
 *   qué límites efectivos, y por qué no cuando no puede.
 * @system valida entrada, receta, actores, entorno y presupuesto; devuelve bloqueos accionables y
 *   un `planHash` que detecta cualquier cambio posterior.
 */
import { createHash } from 'node:crypto';
import type { JourneyTemplate } from './journey-recipe.types.js';
import type { QaBlocker, QaEnvironmentPolicy, QaRunLimits, QaRunRequest } from './qa-run.types.js';
import { validateRecipe } from './recipe-validation.js';

export { FIXTURE_OUTPUTS, PERSONA_FIELDS, validateRecipe } from './recipe-validation.js';

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
  workflowCode: string;
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

export function hashPlan(plan: EffectivePlan): string {
  const ordered = Object.fromEntries(Object.entries(plan).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

type CompileInput = {
  request: QaRunRequest;
  template: JourneyTemplate | undefined;
  recipeHash: string | null;
  environment: QaEnvironmentPolicy | undefined;
  readiness: RuntimeReadiness;
  generatorVersion: string;
};

function inputBlockers(request: QaRunRequest): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  if (!positiveInteger(request.persons))
    blockers.push({ code: 'INVALID_INPUT', message: 'Personas tiene que ser un entero mayor que cero.', subject: 'persons' });
  if (!positiveInteger(request.concurrency))
    blockers.push({ code: 'INVALID_INPUT', message: 'Concurrencia tiene que ser un entero mayor que cero.', subject: 'concurrency' });
  return blockers;
}

/** N total y personas simultáneas son controles distintos; por encima del entorno se rechaza. */
function capacityBlockers(request: QaRunRequest, environment: QaEnvironmentPolicy): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  if (environment.deploymentEnvironment === 'PROD') {
    blockers.push({
      code: 'UNSAFE_ENVIRONMENT',
      message: 'Producción no admite corridas QA ni contexto de mock.',
      subject: 'environmentId',
    });
  }
  if (request.persons > environment.maxPersons) {
    blockers.push({
      code: 'BUDGET_EXCEEDED',
      message: `El entorno admite hasta ${environment.maxPersons} personas; se pidieron ${request.persons}.`,
      subject: 'persons',
    });
  }
  if (request.concurrency > environment.maxConcurrency) {
    blockers.push({
      code: 'BUDGET_EXCEEDED',
      message: `El entorno admite hasta ${environment.maxConcurrency} personas simultáneas.`,
      subject: 'concurrency',
    });
  }
  if (request.concurrency > request.persons) {
    blockers.push({ code: 'INVALID_INPUT', message: 'La concurrencia no puede superar al total de personas.', subject: 'concurrency' });
  }
  return blockers;
}

/** El mínimo entre lo pedido y la política; pedir más que el tope es un bloqueo, no un recorte. */
function effectiveLimits(request: QaRunRequest, environment: QaEnvironmentPolicy): { limits: QaRunLimits; blockers: QaBlocker[] } {
  const limits: QaRunLimits = { ...environment.limits };
  const blockers: QaBlocker[] = [];
  for (const key of Object.keys(limits) as Array<keyof QaRunLimits>) {
    const requested = request.limits?.[key];
    if (requested === undefined) continue;
    if (!positiveInteger(requested))
      blockers.push({ code: 'INVALID_INPUT', message: `${key} tiene que ser un entero positivo.`, subject: key });
    else if (requested > environment.limits[key])
      blockers.push({ code: 'BUDGET_EXCEEDED', message: `${key} supera el tope del entorno (${environment.limits[key]}).`, subject: key });
    else limits[key] = requested;
  }
  return { limits, blockers };
}

function templateBlockers(request: QaRunRequest, template: JourneyTemplate): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  if (template.status !== 'READY') {
    blockers.push({
      code: 'TEMPLATE_NOT_READY',
      message: `La plantilla está ${template.status}: ${(template.blockedReasons ?? []).join('; ') || 'sin validar'}.`,
    });
  }
  if (!template.scenarios.includes(request.scenarioCode)) {
    blockers.push({
      code: 'SCENARIO_UNSUPPORTED',
      message: `La plantilla no interpreta el escenario ${request.scenarioCode}.`,
      subject: request.scenarioCode,
    });
  }
  if (!template.datasetModes.includes(request.datasetMode)) {
    blockers.push({ code: 'INVALID_INPUT', message: `La plantilla no admite datos ${request.datasetMode}.`, subject: 'datasetMode' });
  }
  return [...blockers, ...validateRecipe(template)];
}

export function templateProviders(template: JourneyTemplate): string[] {
  return [...new Set(template.steps.flatMap((step) => (step.providers ?? []).map((provider) => provider.provider)))].sort();
}

function readinessBlockers(request: QaRunRequest, template: JourneyTemplate, readiness: RuntimeReadiness): QaBlocker[] {
  const blockers: QaBlocker[] = [];
  for (const actor of template.actors) {
    if ((actor === 'internal_user' || actor === 'merchant_user') && !readiness.availableActors.includes(actor)) {
      blockers.push({
        code: 'ACTOR_UNAVAILABLE',
        message: `No hay un actor ${actor} provisionado para QA en este entorno.`,
        subject: actor,
      });
    }
  }
  if (!readiness.workerReady)
    blockers.push({ code: 'WORKER_UNAVAILABLE', message: 'No hay un worker QA disponible. No se ha iniciado ninguna persona.' });
  const providers = templateProviders(template);
  if (providers.length === 0 || request.mode !== 'INTEGRATED_QA') return blockers;
  if (!readiness.mockReachable)
    blockers.push({ code: 'MOCK_UNAVAILABLE', message: 'El mock de proveedores no responde; la evidencia externa no podría comprobarse.' });
  for (const provider of providers) {
    const supported = readiness.mockScenarios?.[provider];
    if (readiness.mockScenarios && !supported?.includes(request.scenarioCode)) {
      blockers.push({
        code: 'SCENARIO_UNSUPPORTED',
        message: `El proveedor ${provider} no admite el escenario ${request.scenarioCode}.`,
        subject: provider,
      });
    }
  }
  return blockers;
}

/** Solicitudes posibles (reintentos y sondeos incluidos) y espera de admisión por el cupo más lento. */
function budget(request: QaRunRequest, template: JourneyTemplate, limits: QaRunLimits) {
  const perPersona = template.steps.reduce(
    (sum, step) =>
      sum + Math.max(1, step.retry?.maxAttempts ?? 1) + (step.poll ? Math.ceil(step.poll.deadlineMs / step.poll.intervalMs) : 0),
    0,
  );
  const estimatedRequests = request.persons * perPersona;
  const slowest = Math.min(...template.steps.map((step) => step.rateLimit?.perMinute ?? Number.POSITIVE_INFINITY));
  // N altas a 10/min tardan N/10 minutos antes de cualquier otro paso.
  const estimatedAdmissionMs = Number.isFinite(slowest) ? Math.max(0, Math.ceil(request.persons / slowest) - 1) * 60_000 : 0;
  const blockers: QaBlocker[] = [];
  if (estimatedRequests > limits.maxRequests) {
    blockers.push({
      code: 'BUDGET_EXCEEDED',
      message: `El recorrido puede emitir hasta ${estimatedRequests} solicitudes y el presupuesto es ${limits.maxRequests}.`,
      subject: 'maxRequests',
    });
  }
  if (estimatedAdmissionMs > limits.maxDurationMs) {
    const minutes = Math.round(estimatedAdmissionMs / 60_000);
    blockers.push({
      code: 'BUDGET_EXCEEDED',
      message: `Sólo la admisión limitada por tasa tardaría ~${minutes} min; el tope es ${Math.round(limits.maxDurationMs / 60_000)} min.`,
      subject: 'maxDurationMs',
    });
  }
  return { estimatedRequests, estimatedAdmissionMs, blockers };
}

export function compilePlan(input: CompileInput): PlanResult {
  const { request, template, environment } = input;
  const blocked = (blockers: QaBlocker[]): PlanResult => ({ status: 'BLOCKED', blockers, plan: null, planHash: null });
  const invalid = inputBlockers(request);
  if (!environment) {
    return blocked([
      ...invalid,
      { code: 'UNSAFE_ENVIRONMENT', message: `El entorno ${request.environmentId} no está registrado para QA.`, subject: 'environmentId' },
    ]);
  }
  if (!template)
    return blocked([
      ...invalid,
      { code: 'TEMPLATE_NOT_READY', message: `No existe la plantilla ${request.templateCode}@${request.templateVersion}.` },
    ]);
  if (invalid.length > 0) return blocked(invalid);

  const { limits, blockers: limitBlockers } = effectiveLimits(request, environment);
  const estimate = budget(request, template, limits);
  const blockers = [
    ...capacityBlockers(request, environment),
    ...limitBlockers,
    ...templateBlockers(request, template),
    ...readinessBlockers(request, template, input.readiness),
    ...estimate.blockers,
  ];
  if (blockers.length > 0) return blocked(blockers);
  const plan: EffectivePlan = {
    templateCode: template.code,
    templateVersion: template.version,
    recipeHash: input.recipeHash ?? '',
    workflowCode: request.workflowCode ?? template.workflowCode,
    environmentId: environment.environmentId,
    mode: request.mode,
    persons: request.persons,
    concurrency: request.concurrency,
    seed: request.seed,
    datasetMode: request.datasetMode,
    scenarioCode: request.scenarioCode,
    limits,
    generatorVersion: input.generatorVersion,
    estimatedRequests: estimate.estimatedRequests,
    estimatedAdmissionMs: estimate.estimatedAdmissionMs,
    stepCount: template.steps.length,
    providers: templateProviders(template),
  };
  return { status: 'READY', blockers: [], plan, planHash: hashPlan(plan) };
}
