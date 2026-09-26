import { Logger } from '@nestjs/common';
import { env } from '../../../src/config/env';
import type { StepRecord } from '../../../src/modules/qa-orchestration/application/executor.ports';
import type { QaEnvironmentService } from '../../../src/modules/qa-orchestration/application/qa-environment';
import { QaRunClosing, type RunContext } from '../../../src/modules/qa-orchestration/application/qa-run-closing';
import { QaRunExecutionService } from '../../../src/modules/qa-orchestration/application/qa-run-execution.service';
import { findTemplate, recipeHash } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import { compilePlan, type EffectivePlan } from '../../../src/modules/qa-orchestration/domain/journey-plan';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import type { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';
import type { QaRunSupportRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-support.repository';
import type {
  PersonaCheckpoint,
  QaRunWorkerRepository,
} from '../../../src/modules/qa-orchestration/infrastructure/qa-run-worker.repository';

type Mutable = Record<string, unknown>;
type FinishInput = Parameters<QaRunWorkerRepository['finishRun']>[0];
type PersonaUpdate = Parameters<QaRunWorkerRepository['updatePersona']>[0];

const BASE_URL = 'http://qa-backend.local/api/v1';
const fence = { jobRunId: '7001', fencingToken: '3' };
const TEMPLATE = findTemplate('account_signup_to_login', '1.0.0')!;

function frozenPlan(overrides: Partial<EffectivePlan> = {}): EffectivePlan {
  const result = compilePlan({
    request: {
      templateCode: TEMPLATE.code,
      templateVersion: TEMPLATE.version,
      environmentId: 'qa-local',
      mode: 'INTEGRATED_QA',
      persons: 2,
      concurrency: 2,
      seed: 'semilla-qa',
      datasetMode: 'NORMAL_SYNTHETIC',
      scenarioCode: 'happy_path',
    },
    template: TEMPLATE,
    recipeHash: recipeHash(TEMPLATE),
    environment: {
      environmentId: 'qa-local',
      label: 'QA local',
      deploymentEnvironment: 'TEST',
      maxPersons: 100,
      maxConcurrency: 10,
      limits: { maxRequests: 3000, maxDurationMs: 600_000, maxInFlightRequests: 10 },
    },
    readiness: { workerReady: true, mockReachable: true, mockScenarios: {}, availableActors: [] },
    generatorVersion: 'persona-factory@1',
  });
  return { ...result.plan!, ...overrides };
}

type PersonaState = { personaRunId: string; ordinal: number; personaKey: string; status: string; resources: Record<string, unknown> };

/**
 * Base en memoria con la forma de los repositorios del worker: personas, pasos, eventos y cierre.
 * `fenceValid = false` simula que otro worker ya tomó el job: toda escritura cercada devuelve false.
 */
function fakeWorld(plan: EffectivePlan, runOverrides: Mutable = {}) {
  const world = {
    run: {
      _id: '42',
      _tenant_id: '7',
      status: 'QUEUED',
      plan_snapshot: plan as unknown as Record<string, unknown>,
      namespace: 'qa-ns-42',
      reference_date: '2026-09-24',
      seed: plan.seed,
      cancel_requested_at: null,
      job_run_id: '7001',
      ...runOverrides,
    } as Mutable | null,
    personas: Array.from({ length: plan.persons }, (_, index): PersonaState => ({
      personaRunId: String(100 + index),
      ordinal: index + 1,
      personaKey: `p-${String(index + 1).padStart(4, '0')}`,
      status: 'PENDING',
      resources: {},
    })),
    steps: new Map<string, StepRecord[]>(),
    events: [] as string[],
    requests: 0,
    fenceValid: true,
    finished: null as FinishInput | null,
    closedPending: [] as Array<{ status: string; reason: string }>,
  };
  const persona = (id: string) => world.personas.find((candidate) => candidate.personaRunId === id)!;
  const runs = {
    loadRun: jest.fn(async () => world.run),
    markRunning: jest.fn(async () => world.fenceValid),
    isCancelRequested: jest.fn(async () => false),
    appendEvent: jest.fn(async (_runId: string, type: string) => void world.events.push(type)),
    loadCheckpoints: jest.fn(async (): Promise<PersonaCheckpoint[]> =>
      world.personas.map((state) => ({
        ...state,
        resources: { ...state.resources },
        steps: [...(world.steps.get(state.personaRunId) ?? [])],
      })),
    ),
    upsertStep: jest.fn(async (_runId: string, personaRunId: string, step: StepRecord) => {
      const list = (world.steps.get(personaRunId) ?? []).filter((candidate) => candidate.stepKey !== step.stepKey);
      world.steps.set(personaRunId, [...list, step]);
      return world.fenceValid;
    }),
    addRequests: jest.fn(async (_runId: string, count: number) => void (world.requests += count)),
    mergeResources: jest.fn(async (personaRunId: string, resources: Record<string, unknown>) => {
      Object.assign(persona(personaRunId).resources, resources);
    }),
    updatePersona: jest.fn(async (input: PersonaUpdate) => {
      persona(input.personaRunId).status = input.status;
      return world.fenceValid;
    }),
    closePendingPersonas: jest.fn(async (_runId: string, status: string, reason: string) => {
      world.closedPending.push({ status, reason });
      for (const state of world.personas) if (['PENDING', 'RUNNING'].includes(state.status)) state.status = status;
    }),
    requestsIssued: jest.fn(async () => world.requests),
    finishRun: jest.fn(async (input: FinishInput) => {
      if (!world.fenceValid) return false;
      world.finished = input;
      return true;
    }),
  };
  const query = {
    personaTally: jest.fn(async () => {
      const counts = new Map<string, number>();
      for (const state of world.personas) counts.set(state.status, (counts.get(state.status) ?? 0) + 1);
      return [...counts].map(([status, count]) => ({ status, count: String(count) }));
    }),
    stepTally: jest.fn(async () =>
      [...world.steps.values()]
        .flat()
        .map((step) => ({ step_key: step.stepKey, workflow_step_code: null, status: step.status, count: '1' })),
    ),
  };
  const support = {
    readSecret: jest.fn(async (): Promise<{ token: string | null; epoch: string | null } | null> => null),
    saveSecret: jest.fn(async () => undefined),
    purgeSecret: jest.fn(async () => undefined),
    findActiveCreditProduct: jest.fn(async () => null),
  };
  const mock = {
    configured: false,
    openRun: jest.fn(async () => ({ runToken: 'rt-mock', epoch: 'e-1' })),
    readJournal: jest.fn(async () => ({ entries: [], totalAppended: 0, droppedByRetention: 0, complete: true })),
    closeRun: jest.fn(async () => undefined),
  };
  const environments = { disabledReason: jest.fn((): string | null => null), mock };
  const closing = new QaRunClosing(
    runs as unknown as QaRunWorkerRepository,
    query as unknown as QaRunQueryRepository,
    environments as unknown as QaEnvironmentService,
    support as unknown as QaRunSupportRepository,
  );
  const service = new QaRunExecutionService(
    runs as unknown as QaRunWorkerRepository,
    environments as unknown as QaEnvironmentService,
    closing,
    support as unknown as QaRunSupportRepository,
  );
  return { world, runs, query, support, mock, environments, closing, service };
}

type Hook = (path: string) => Response | void;

/**
 * Backend QA falso detrás de `fetch`: cada alta crea SU cliente y cada token identifica a SU
 * cliente, como el servicio real. `hook` permite intervenir una ruta (fallar, abortar la corrida).
 */
function fakeBackend(hook: Hook = () => undefined) {
  let next = 500;
  const byEmail = new Map<string, string>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  return jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).replace(BASE_URL, '').split('?')[0];
    const intercepted = hook(path);
    if (intercepted) return intercepted;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (path === '/consent-documents/active') return json({ data: [{ id: 1, documentCode: 'terms' }] });
    if (path === '/customer-onboarding/start') {
      const customerId = String(next++);
      byEmail.set(body.customer.email, customerId);
      return json(
        { data: { customerId, lifecycleStatus: 'registered', tokens: { accessToken: `tok-${customerId}`, refreshToken: 'r' } } },
        201,
      );
    }
    if (path === '/auth/login') return json({ data: { accessToken: `tok-${byEmail.get(body.identifier)}`, refreshToken: 'r' } });
    if (path === '/auth/me') return json({ data: { customerId: headers.authorization?.replace('Bearer tok-', '') } });
    return json({ error: { code: 'NOT_FOUND' } }, 404);
  });
}

const savedEnv: Mutable = {};
const savedProcess: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ['QA_TARGET_BASE_URL', 'QA_EXECUTION_SECRET', 'QA_TARGET_SHARES_DATABASE']) savedEnv[key] = (env as Mutable)[key];
  savedProcess.ATLAS_DEPLOYMENT_ENVIRONMENT = process.env.ATLAS_DEPLOYMENT_ENVIRONMENT;
  Object.assign(env as Mutable, {
    QA_TARGET_BASE_URL: BASE_URL,
    QA_EXECUTION_SECRET: 'secreto-de-pruebas-del-worker-qa-32-caracteres',
    QA_TARGET_SHARES_DATABASE: false,
  });
  process.env.ATLAS_DEPLOYMENT_ENVIRONMENT = 'TEST';
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  Object.assign(env as Mutable, savedEnv);
  if (savedProcess.ATLAS_DEPLOYMENT_ENVIRONMENT === undefined) delete process.env.ATLAS_DEPLOYMENT_ENVIRONMENT;
  else process.env.ATLAS_DEPLOYMENT_ENVIRONMENT = savedProcess.ATLAS_DEPLOYMENT_ENVIRONMENT;
  jest.restoreAllMocks();
});

const signal = () => new AbortController().signal;

describe('ejecución de una corrida QA: antes de la primera persona', () => {
  it('una receta cambiada desde el preflight cierra la corrida BLOCKED sin generar tráfico', async () => {
    const { service, world, runs } = fakeWorld(frozenPlan({ recipeHash: 'receta-vieja' }));
    const http = fakeBackend();
    const outcome = await service.execute('42', fence, signal());
    expect(outcome).toEqual({ kind: 'FINISHED', jobStatus: 'completed', runStatus: 'BLOCKED', verdict: null });
    expect(world.finished).toMatchObject({ status: 'BLOCKED', errorMessage: expect.stringContaining('preflight nuevo') });
    expect(runs.markRunning).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it('una corrida ya terminal no se vuelve a ejecutar; una inexistente es un error de infraestructura', async () => {
    const terminal = fakeWorld(frozenPlan(), { status: 'CANCELLED' });
    expect(await terminal.service.execute('42', fence, signal())).toEqual({
      kind: 'FINISHED',
      jobStatus: 'completed',
      runStatus: 'CANCELLED',
      verdict: null,
    });
    expect(terminal.runs.finishRun).not.toHaveBeenCalled();

    const missing = fakeWorld(frozenPlan());
    missing.world.run = null;
    await expect(missing.service.execute('42', fence, signal())).rejects.toThrow('QA_RUN_NOT_FOUND:42');
  });

  it('sin backend de destino la corrida se bloquea con el motivo del entorno', async () => {
    (env as Mutable).QA_TARGET_BASE_URL = undefined;
    const { service, world, environments } = fakeWorld(frozenPlan());
    environments.disabledReason.mockReturnValue('Falta QA_TARGET_BASE_URL: no hay un backend QA de destino.');
    expect(await service.execute('42', fence, signal())).toMatchObject({ kind: 'FINISHED', runStatus: 'BLOCKED' });
    expect(world.finished?.errorMessage).toContain('QA_TARGET_BASE_URL');
  });

  it('si otro worker ya tiene el job, se abandona sin escribir (LOST_LEASE)', async () => {
    const { service, world, runs } = fakeWorld(frozenPlan());
    world.fenceValid = false;
    expect(await service.execute('42', fence, signal())).toEqual({ kind: 'ABANDONED', reason: 'LOST_LEASE' });
    expect(runs.appendEvent).not.toHaveBeenCalled();
  });

  it('una fixture que falta bloquea a todas las personas pendientes y la corrida', async () => {
    const { service, world } = fakeWorld(frozenPlan());
    fakeBackend((path) => (path === '/consent-documents/active' ? new Response('{"data":[]}', { status: 200 }) : undefined));
    expect(await service.execute('42', fence, signal())).toMatchObject({ kind: 'FINISHED', runStatus: 'BLOCKED' });
    expect(world.closedPending).toEqual([{ status: 'BLOCKED', reason: expect.stringContaining('consentimientos') }]);
    expect(world.finished?.errorMessage).toMatch(/^FIXTURE_MISSING: /);
    expect(world.personas.every((state) => state.status === 'BLOCKED')).toBe(true);
  });

  it('INTEGRATED_QA con proveedores y sin namespace en el mock es FAILED_INFRASTRUCTURE', async () => {
    const { service, world, mock } = fakeWorld(frozenPlan({ providers: ['SEGIP'] }));
    mock.configured = true;
    mock.openRun.mockRejectedValueOnce(new Error('MOCK_RUN_NOT_CREATED:503:sin código'));
    fakeBackend();
    expect(await service.execute('42', fence, signal())).toEqual({
      kind: 'FINISHED',
      jobStatus: 'failed',
      runStatus: 'FAILED_INFRASTRUCTURE',
      verdict: null,
    });
    expect(world.finished?.evidence).toMatchObject({ mockNamespace: false, mockConfirmed: false });
  });
});

describe('ejecución de una corrida QA: personas y cierre', () => {
  it('dos personas recorren su flujo con sesiones propias y la corrida termina COMPLETED/PASSED', async () => {
    const { service, world } = fakeWorld(frozenPlan());
    const http = fakeBackend();
    const outcome = await service.execute('42', fence, signal());
    expect(outcome).toEqual({ kind: 'FINISHED', jobStatus: 'completed', runStatus: 'COMPLETED', verdict: 'PASSED' });
    expect(world.personas.map((state) => state.status)).toEqual(['PASSED', 'PASSED']);
    // Cada persona se quedó con SU cliente: los recursos extraídos no se cruzan.
    const customers = world.personas.map((state) => state.resources.customerId);
    expect(new Set(customers).size).toBe(2);
    expect(world.requests).toBe(8);
    expect(world.finished).toMatchObject({
      status: 'COMPLETED',
      verdict: 'PASSED',
      counters: { personsRequested: 2, personsPassed: 2, stepsPassed: 8, requestsIssued: 8 },
    });
    expect(world.events).toEqual(['RUN_STARTED', 'PERSONA_FINISHED', 'PERSONA_FINISHED', 'RUN_FINISHED']);
    // Toda petición de una persona lleva la credencial QA firmada, y el tenant de la corrida.
    const personaCalls = http.mock.calls.filter(([url]) => !String(url).endsWith('/consent-documents/active'));
    expect(personaCalls.length).toBeGreaterThan(0);
    for (const [, init] of personaCalls)
      expect(init?.headers).toMatchObject({ 'x-tenant-id': '7', 'x-atlas-qa-execution': expect.any(String) });
  });

  it('con namespace en el mock guarda el runToken CIFRADO, reconcilia el journal y cierra el namespace', async () => {
    const { service, world, mock, support } = fakeWorld(frozenPlan());
    mock.configured = true;
    fakeBackend();
    expect(await service.execute('42', fence, signal())).toMatchObject({ runStatus: 'COMPLETED', verdict: 'PASSED' });
    expect(mock.openRun).toHaveBeenCalledWith({ tenantId: '7', runId: 'qa-ns-42', seed: 'semilla-qa', scenarioProfile: 'happy_path' });
    const [runId, stored, epoch] = support.saveSecret.mock.calls[0] as unknown as [string, string, string];
    expect(runId).toBe('42');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('rt-mock');
    expect(epoch).toBe('e-1');
    expect(world.events).toContain('MOCK_NAMESPACE_OPENED');
    expect(mock.readJournal).toHaveBeenCalledWith('7', 'qa-ns-42');
    expect(support.purgeSecret).toHaveBeenCalledWith('42');
    expect(mock.closeRun).toHaveBeenCalledWith('7', 'qa-ns-42');
    expect(world.finished?.evidence).toMatchObject({ mockNamespace: true, journal: { complete: true } });
  });

  it('un secreto vigente del intento anterior reutiliza el namespace en vez de abrir otro', async () => {
    const { service, mock, support } = fakeWorld(frozenPlan());
    mock.configured = true;
    support.readSecret.mockResolvedValue({ token: 'v1:cifrado', epoch: 'e-0' });
    fakeBackend();
    await service.execute('42', fence, signal());
    expect(mock.openRun).not.toHaveBeenCalled();
  });

  it('agotado el presupuesto, las personas quedan indeterminadas y el cierre lo dice', async () => {
    const { service, world } = fakeWorld(frozenPlan({ limits: { maxRequests: 3, maxDurationMs: 600_000, maxInFlightRequests: 10 } }));
    fakeBackend();
    const outcome = await service.execute('42', fence, signal());
    expect(outcome).toMatchObject({ kind: 'FINISHED', runStatus: 'COMPLETED', verdict: 'INCONCLUSIVE' });
    expect(world.finished?.errorMessage).toBe('BUDGET_EXHAUSTED');
    expect(world.closedPending).toEqual([{ status: 'BLOCKED', reason: 'se agotó el presupuesto de solicitudes' }]);
  });

  it.each(['LOST_LEASE', 'SHUTDOWN'])('un %s en mitad de la corrida la abandona sin cerrarla', async (reason) => {
    const { service, world } = fakeWorld(frozenPlan());
    const external = new AbortController();
    fakeBackend((path) => {
      if (path === '/auth/login') external.abort(reason);
    });
    expect(await service.execute('42', fence, external.signal)).toEqual({ kind: 'ABANDONED', reason });
    expect(world.finished).toBeNull();
    expect(world.events).not.toContain('PERSONA_FINISHED');
  });

  it('una cancelación observada cierra CANCELLED y cancela lo pendiente', async () => {
    const { service, world } = fakeWorld(frozenPlan());
    const external = new AbortController();
    fakeBackend((path) => {
      if (path === '/auth/login') external.abort('CANCELLED');
    });
    expect(await service.execute('42', fence, external.signal)).toMatchObject({ kind: 'FINISHED', runStatus: 'CANCELLED' });
    expect(world.closedPending).toEqual([{ status: 'CANCELLED', reason: 'corrida cancelada' }]);
    expect(world.finished?.status).toBe('CANCELLED');
  });

  it('un apagado que llega ANTES de empezar abandona la corrida sin marcarla RUNNING', async () => {
    const { service, world, runs } = fakeWorld(frozenPlan());
    const http = fakeBackend();
    const external = new AbortController();
    external.abort('SHUTDOWN');
    expect(await service.execute('42', fence, external.signal)).toEqual({ kind: 'ABANDONED', reason: 'SHUTDOWN' });
    expect(runs.markRunning).not.toHaveBeenCalled();
    expect(world.finished).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });

  it('un apagado durante las fixtures abandona la corrida en vez de cerrarla BLOCKED por fixture faltante', async () => {
    const { service, world } = fakeWorld(frozenPlan());
    const external = new AbortController();
    fakeBackend((path) => {
      if (path === '/consent-documents/active') {
        external.abort('SHUTDOWN');
        return new Response('{"data":[]}', { status: 200 });
      }
    });
    expect(await service.execute('42', fence, external.signal)).toEqual({ kind: 'ABANDONED', reason: 'SHUTDOWN' });
    expect(world.finished).toBeNull();
    expect(world.closedPending).toEqual([]);
  });

  it('failInfrastructure bloquea las personas en vuelo y cierra la corrida; una terminal no se toca', async () => {
    const vivo = fakeWorld(frozenPlan(), { status: 'RUNNING' });
    await vivo.service.failInfrastructure('42', fence, 'boom');
    expect(vivo.world.closedPending).toEqual([{ status: 'BLOCKED', reason: 'fallo del worker: boom' }]);
    expect(vivo.world.finished).toMatchObject({ status: 'FAILED_INFRASTRUCTURE', errorMessage: 'boom', verdict: null });

    const terminal = fakeWorld(frozenPlan(), { status: 'COMPLETED' });
    await terminal.service.failInfrastructure('42', fence, 'boom');
    expect(terminal.runs.finishRun).not.toHaveBeenCalled();
  });
});

describe('cierre de una corrida QA', () => {
  const PROVIDER_TEMPLATE: JourneyTemplate = {
    ...TEMPLATE,
    steps: [{ ...TEMPLATE.steps[0], providers: [{ provider: 'SEGIP', expectCall: 'required' }] }],
  };

  function ctxFor(world: ReturnType<typeof fakeWorld>, template: JourneyTemplate): RunContext {
    return {
      runId: '42',
      tenantId: '7',
      fence,
      plan: frozenPlan(),
      template,
      namespace: 'qa-ns-42',
      seed: 'semilla-qa',
      referenceDate: '2026-09-24',
    };
  }

  const passedStep = (stepKey: string): StepRecord => ({
    stepKey,
    visitIndex: 0,
    logicalOperationId: 'op-1',
    status: 'PASSED',
    failures: [],
    attempts: [],
    evidence: { method: 'GET', path: '/x' },
    startedAt: '',
    finishedAt: '',
  });

  it('una expectativa de proveedor incumplida convierte el paso y la persona en FAILED', async () => {
    const fake = fakeWorld(frozenPlan());
    fake.world.steps.set('100', [passedStep(PROVIDER_TEMPLATE.steps[0].stepKey)]);
    const evidence = await fake.closing.reconcile(ctxFor(fake, PROVIDER_TEMPLATE), true);
    expect(evidence).toMatchObject({
      mockNamespace: true,
      mockConfirmed: false,
      violations: [expect.objectContaining({ expected: 'required' })],
    });
    expect(fake.world.steps.get('100')![0]).toMatchObject({
      status: 'FAILED',
      failures: [expect.objectContaining({ code: 'ASSERTION_EQUALS_FAILED' })],
    });
    expect(fake.world.personas[0].status).toBe('FAILED');
    expect(fake.support.purgeSecret).toHaveBeenCalledWith('42');
  });

  it('sin namespace no se lee el journal ni se cierra nada en el mock', async () => {
    const fake = fakeWorld(frozenPlan());
    const evidence = await fake.closing.reconcile(ctxFor(fake, PROVIDER_TEMPLATE), false);
    expect(evidence).toMatchObject({ mockNamespace: false, mockConfirmed: false, journal: null });
    expect(fake.mock.readJournal).not.toHaveBeenCalled();
    expect(fake.mock.closeRun).not.toHaveBeenCalled();
  });

  it('un journal ilegible cuenta como ausente, no como confirmado', async () => {
    const fake = fakeWorld(frozenPlan());
    fake.mock.readJournal.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await fake.closing.reconcile(ctxFor(fake, PROVIDER_TEMPLATE), true)).toMatchObject({ mockConfirmed: false, journal: null });
  });

  it('un cierre sin lease es ABANDONED y no publica RUN_FINISHED', async () => {
    const fake = fakeWorld(frozenPlan());
    fake.world.fenceValid = false;
    expect(await fake.closing.finish(ctxFor(fake, TEMPLATE), { status: 'COMPLETED', verdict: 'PASSED', evidence: {} })).toEqual({
      kind: 'ABANDONED',
      reason: 'LOST_LEASE',
    });
    expect(fake.world.events).toEqual([]);
  });
});
