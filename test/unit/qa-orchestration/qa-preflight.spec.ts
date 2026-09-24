import { compilePlan, validateRecipe, type RuntimeReadiness } from '../../../src/modules/qa-orchestration/domain/journey-plan';
import { JOURNEY_TEMPLATES, findTemplate, recipeHash } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import type { QaEnvironmentPolicy, QaRunRequest } from '../../../src/modules/qa-orchestration/domain/qa-run.types';

const environment: QaEnvironmentPolicy = {
  environmentId: 'qa-isolated',
  label: 'QA aislado',
  deploymentEnvironment: 'TEST',
  maxPersons: 100,
  maxConcurrency: 10,
  limits: { maxRequests: 3000, maxDurationMs: 1_800_000, maxInFlightRequests: 10 },
};
const ready: RuntimeReadiness = {
  workerReady: true,
  mockReachable: true,
  mockScenarios: { SEGIP: ['happy_path', 'provider_down'] },
  availableActors: [],
};
const request = (overrides: Partial<QaRunRequest> = {}): QaRunRequest => ({
  templateCode: 'account_signup_to_login',
  templateVersion: '1.0.0',
  environmentId: 'qa-isolated',
  mode: 'INTEGRATED_QA',
  persons: 20,
  concurrency: 5,
  seed: 'atlas-qa-regression-v1',
  datasetMode: 'NORMAL_SYNTHETIC',
  scenarioCode: 'happy_path',
  ...overrides,
});
const compile = (overrides: Partial<QaRunRequest> = {}, readiness = ready, env: QaEnvironmentPolicy | undefined = environment) => {
  const req = request(overrides);
  const template = findTemplate(req.templateCode, req.templateVersion);
  return compilePlan({
    request: req,
    template,
    recipeHash: template ? recipeHash(template) : null,
    environment: env,
    readiness,
    generatorVersion: 'persona-factory@1',
  });
};

describe('preflight de una corrida QA', () => {
  it.each([0, -1, 1.5])('rechaza personas = %p sin clamp', (persons) => {
    const result = compile({ persons, concurrency: 1 });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers[0]).toMatchObject({ code: 'INVALID_INPUT', subject: 'persons' });
  });

  it('rechaza un exceso con mensaje concreto en vez de recortarlo en silencio', () => {
    const result = compile({ persons: 101 });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'BUDGET_EXCEEDED', subject: 'persons' }));
    expect(result.plan).toBeNull();
  });

  it('concurrencia y total son controles distintos', () => {
    expect(compile({ persons: 3, concurrency: 5 }).blockers).toContainEqual(expect.objectContaining({ subject: 'concurrency' }));
  });

  it('un límite pedido por encima del entorno se rechaza; por debajo se aplica', () => {
    expect(compile({ limits: { maxRequests: 99_999 } }).blockers).toContainEqual(expect.objectContaining({ subject: 'maxRequests' }));
    expect(compile({ limits: { maxInFlightRequests: 4 } }).plan?.limits.maxInFlightRequests).toBe(4);
  });

  it('produce un plan READY con hash estable para la misma entrada', () => {
    const first = compile();
    const second = compile();
    expect(first.status).toBe('READY');
    expect(first.planHash).toBe(second.planHash);
    expect(compile({ seed: 'otra' }).planHash).not.toBe(first.planHash);
  });

  it('PROD queda bloqueado aunque el resto sea válido (A19/A30)', () => {
    const result = compile({}, ready, { ...environment, deploymentEnvironment: 'PROD' });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'UNSAFE_ENVIRONMENT' }));
  });

  it('sin worker saludable no anuncia ejecución (A23)', () => {
    expect(compile({}, { ...ready, workerReady: false }).blockers).toContainEqual(expect.objectContaining({ code: 'WORKER_UNAVAILABLE' }));
  });

  it('un escenario que el proveedor no admite bloquea en vez de volver al happy path', () => {
    const result = compile({ templateCode: 'customer_credit_decision', scenarioCode: 'timeout' });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'SCENARIO_UNSUPPORTED', subject: 'SEGIP' }));
  });

  it('mock caído bloquea una plantilla que exige evidencia de proveedor (A10)', () => {
    const result = compile({ templateCode: 'customer_credit_decision' }, { ...ready, mockReachable: false });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'MOCK_UNAVAILABLE' }));
  });

  it('la admisión limitada por tasa cuenta en el presupuesto de duración', () => {
    const result = compile({ persons: 100, concurrency: 10, limits: { maxDurationMs: 60_000 } });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'BUDGET_EXCEEDED', subject: 'maxDurationMs' }));
  });
});

describe('validación de recetas', () => {
  const base: JourneyTemplate = { ...findTemplate('account_signup_to_login', '1.0.0')! };

  it('todas las plantillas publicadas son válidas', () => {
    for (const template of JOURNEY_TEMPLATES) expect(validateRecipe(template)).toEqual([]);
  });

  it('una referencia que ningún paso anterior produce bloquea', () => {
    const template: JourneyTemplate = { ...base, steps: [{ ...base.steps[0], path: '/x/{{resources.customerId}}' }] };
    expect(validateRecipe(template)).toContainEqual(expect.objectContaining({ code: 'BINDING_UNRESOLVED' }));
  });

  it('una dependencia posterior (ciclo) bloquea', () => {
    const [first, second] = base.steps;
    const template: JourneyTemplate = { ...base, steps: [{ ...first, dependsOn: [second.stepKey] }, second] };
    expect(validateRecipe(template)).toContainEqual(expect.objectContaining({ code: 'GRAPH_INVALID' }));
  });

  it('reintentar una escritura sin idempotencia es un error de receta', () => {
    const template: JourneyTemplate = { ...base, steps: [{ ...base.steps[2], dependsOn: [], retry: { maxAttempts: 3 } }] };
    expect(validateRecipe(template)).toContainEqual(expect.objectContaining({ code: 'GRAPH_INVALID' }));
  });

  it('cambiar la receta cambia su hash (A18)', () => {
    const edited: JourneyTemplate = { ...base, steps: base.steps.slice(0, 2) };
    expect(recipeHash(edited)).not.toBe(recipeHash(base));
  });
});
