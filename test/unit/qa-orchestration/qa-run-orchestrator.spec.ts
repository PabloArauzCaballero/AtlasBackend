import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types';
import { qaError } from '../../../src/modules/qa-orchestration/application/qa-errors';
import type { QaEnvironmentService } from '../../../src/modules/qa-orchestration/application/qa-environment';
import { actorOf, QaRunOrchestratorService } from '../../../src/modules/qa-orchestration/application/qa-run-orchestrator.service';
import type { QaWorkflowMatcher } from '../../../src/modules/qa-orchestration/application/qa-workflow-matcher';
import { findTemplate, recipeHash } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import { compilePlan, type EffectivePlan } from '../../../src/modules/qa-orchestration/domain/journey-plan';
import type { QaEnvironmentPolicy, QaRunRequest } from '../../../src/modules/qa-orchestration/domain/qa-run.types';
import type {
  AdmissionResult,
  QaRunAdmissionRepository,
  StoredPlan,
} from '../../../src/modules/qa-orchestration/infrastructure/qa-run-admission.repository';
import type { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';

const user: AuthenticatedUser = { sub: 'sub-1', tenantId: '7', internalUserId: '11', role: 'SUPER_ADMIN' as AuthenticatedUser['role'] };

const policy: QaEnvironmentPolicy = {
  environmentId: 'qa-local',
  label: 'QA local',
  deploymentEnvironment: 'TEST',
  maxPersons: 100,
  maxConcurrency: 10,
  limits: { maxRequests: 3000, maxDurationMs: 1_800_000, maxInFlightRequests: 10 },
};

const request = (overrides: Partial<QaRunRequest> = {}): QaRunRequest => ({
  templateCode: 'account_signup_to_login',
  templateVersion: '1.0.0',
  environmentId: 'qa-local',
  mode: 'INTEGRATED_QA',
  persons: 4,
  concurrency: 2,
  seed: 'semilla',
  datasetMode: 'NORMAL_SYNTHETIC',
  scenarioCode: 'happy_path',
  ...overrides,
});

const readiness = { workerReady: true, mockReachable: true, mockScenarios: {}, availableActors: [], lastWorkerSeenAt: null };

/** Plan congelado real, compilado como lo haría el preflight: su hash de receta es el publicado. */
function frozenPlan(): { plan: EffectivePlan; planHash: string } {
  const template = findTemplate('account_signup_to_login', '1.0.0')!;
  const result = compilePlan({
    request: request(),
    template,
    recipeHash: recipeHash(template),
    environment: policy,
    readiness,
    generatorVersion: 'persona-factory@1',
  });
  return { plan: result.plan!, planHash: result.planHash! };
}

function build() {
  const environments = {
    readiness: jest.fn(async () => ({ ...readiness })),
    mockCapabilities: jest.fn(async () => ({ reachable: true, schemaVersion: '2026-09', scenarios: {} })),
    disabledReason: jest.fn((): string | null => null),
    environments: jest.fn(() => [policy]),
    environment: jest.fn((id: string) => (id === policy.environmentId ? policy : undefined)),
    mock: { configured: true },
  };
  const admission = {
    savePlan: jest.fn(async () => '501'),
    findPlan: jest.fn(async (): Promise<StoredPlan | null> => null),
    findByIdempotencyKey: jest.fn(async (): Promise<{ _id: string; plan_hash: string; status: string } | null> => null),
    admit: jest.fn(async (): Promise<AdmissionResult> => ({ runId: '42', status: 'QUEUED', replayed: false })),
    requestCancel: jest.fn(async (): Promise<{ status: string } | null> => ({ status: 'CANCELLING' })),
  };
  const query = {
    workerSnapshot: jest.fn(async () => ({ queued: 2, running: 1, lastHeartbeatAt: null })),
    activeRunsForTenant: jest.fn(async () => 0),
  };
  const matcher = { matchedSteps: jest.fn(async () => ['lifecycle.signup']) };
  const service = new QaRunOrchestratorService(
    environments as unknown as QaEnvironmentService,
    admission as unknown as QaRunAdmissionRepository,
    query as unknown as QaRunQueryRepository,
    matcher as unknown as QaWorkflowMatcher,
  );
  return { service, environments, admission, query, matcher };
}

/** La excepción HTTP con su `{ code }`: el filtro sólo publica el código si viene así. */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
  }
  throw new Error('se esperaba un rechazo');
}

describe('errores de la API QA', () => {
  it('traen código y mensaje humano; un mensaje explícito manda; un código desconocido se repite', () => {
    expect(qaError('QA_RUN_ALREADY_ACTIVE')).toEqual({
      code: 'QA_RUN_ALREADY_ACTIVE',
      message: 'Ya hay una corrida QA en curso en este tenant; espera a que termine o cancélala.',
    });
    expect(qaError('QA_DISABLED', 'Producción no admite corridas QA.')).toEqual({
      code: 'QA_DISABLED',
      message: 'Producción no admite corridas QA.',
    });
    expect(qaError('ALGO_NUEVO')).toEqual({ code: 'ALGO_NUEVO', message: 'ALGO_NUEVO' });
  });
});

describe('actor de la sesión', () => {
  it('sin tenant no se opera el laboratorio', () => {
    expect(() => actorOf({ sub: 's', role: user.role })).toThrow(HttpException);
  });

  it('el operador es el usuario interno, luego el de plataforma, luego el sub', () => {
    expect(actorOf(user)).toEqual({ tenantId: '7', operatorId: '11' });
    expect(actorOf({ sub: 's', tenantId: '7', platformUserId: '22', role: user.role })).toEqual({ tenantId: '7', operatorId: '22' });
    expect(actorOf({ sub: 's', tenantId: '7', role: user.role })).toEqual({ tenantId: '7', operatorId: 's' });
  });
});

describe('orquestador de corridas QA: preflight', () => {
  it('READY guarda el plan con 15 minutos de vida y devuelve su id', async () => {
    const { service, admission } = build();
    const antes = Date.now();
    const result = await service.preflight(user, request());
    expect(result.status).toBe('READY');
    expect(result.planId).toBe('501');
    expect(admission.savePlan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '7', operatorId: '11', planHash: result.planHash, plan: result.plan }),
    );
    const expiresAt = new Date(result.expiresAt!).getTime();
    expect(expiresAt - antes).toBeGreaterThanOrEqual(15 * 60_000 - 5);
    expect(expiresAt - antes).toBeLessThanOrEqual(15 * 60_000 + 1_000);
  });

  it('un entorno apagado bloquea con UNSAFE_ENVIRONMENT primero y NO guarda plan', async () => {
    const { service, environments, admission } = build();
    environments.disabledReason.mockReturnValue('Las corridas QA están apagadas en este entorno (QA_EXECUTION_ENABLED).');
    const result = await service.preflight(user, request());
    expect(result).toMatchObject({ status: 'BLOCKED', plan: null, planId: null, planHash: null, expiresAt: null });
    expect(result.blockers[0]).toEqual({ code: 'UNSAFE_ENVIRONMENT', message: expect.stringContaining('apagadas') });
    expect(admission.savePlan).not.toHaveBeenCalled();
  });

  it('lanzar desde un flujo que la plantilla no recorre es un bloqueo, no una corrida vacía', async () => {
    const { service, matcher, admission } = build();
    matcher.matchedSteps.mockResolvedValue([]);
    const result = await service.preflight(user, request({ workflowCode: 'customer_partner_commerce' }));
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'INVALID_INPUT', subject: 'workflowCode' }));
    expect(admission.savePlan).not.toHaveBeenCalled();
  });

  it('con un flujo que sí recorre, el plan congela ese workflowCode', async () => {
    const { service, matcher } = build();
    const result = await service.preflight(user, request({ workflowCode: 'customer_full_lifecycle' }));
    expect(matcher.matchedSteps).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'account_signup_to_login' }),
      'customer_full_lifecycle',
    );
    expect(result.status).toBe('READY');
    expect(result.plan?.workflowCode).toBe('customer_full_lifecycle');
  });
});

describe('orquestador de corridas QA: lanzamiento', () => {
  const stored = (overrides: Partial<StoredPlan> = {}): StoredPlan => {
    const { plan, planHash } = frozenPlan();
    return { planId: '501', tenantId: '7', operatorId: '11', planHash, plan, expiresAt: new Date(Date.now() + 60_000), ...overrides };
  };
  const launchInput = (planHash: string) => ({ planId: '501', planHash, idempotencyKey: 'Lanzamiento-ABC-123456789' });

  it('un plan inexistente o de otro operador es 404 QA_PLAN_NOT_FOUND', async () => {
    const { service, admission } = build();
    expect(await rejection(service.launch(user, launchInput('x')))).toEqual({ status: 404, code: 'QA_PLAN_NOT_FOUND' });
    admission.findPlan.mockResolvedValue(stored({ operatorId: '99' }));
    expect(await rejection(service.launch(user, launchInput(stored().planHash)))).toEqual({ status: 404, code: 'QA_PLAN_NOT_FOUND' });
  });

  it('un hash distinto del validado es 409 PLAN_CHANGED', async () => {
    const { service, admission } = build();
    admission.findPlan.mockResolvedValue(stored());
    expect(await rejection(service.launch(user, launchInput('otro-hash')))).toEqual({ status: 409, code: 'PLAN_CHANGED' });
  });

  it('una receta editada después del preflight también es PLAN_CHANGED', async () => {
    const { service, admission } = build();
    const base = stored();
    admission.findPlan.mockResolvedValue({ ...base, plan: { ...base.plan, recipeHash: 'receta-vieja' } });
    expect(await rejection(service.launch(user, launchInput(base.planHash)))).toEqual({ status: 409, code: 'PLAN_CHANGED' });
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('un plan vencido es 409 PLAN_EXPIRED', async () => {
    const { service, admission } = build();
    const vencido = stored({ expiresAt: new Date(Date.now() - 1) });
    admission.findPlan.mockResolvedValue(vencido);
    expect(await rejection(service.launch(user, launchInput(vencido.planHash)))).toEqual({ status: 409, code: 'PLAN_EXPIRED' });
  });

  it('entorno apagado es 503 QA_DISABLED y sin worker es 503 WORKER_UNAVAILABLE', async () => {
    const { service, admission, environments } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    environments.disabledReason.mockReturnValueOnce('Producción no admite corridas QA.');
    expect(await rejection(service.launch(user, launchInput(plan.planHash)))).toEqual({ status: 503, code: 'QA_DISABLED' });
    environments.readiness.mockResolvedValueOnce({ ...readiness, workerReady: false });
    expect(await rejection(service.launch(user, launchInput(plan.planHash)))).toEqual({ status: 503, code: 'WORKER_UNAVAILABLE' });
  });

  it('con una corrida activa en el tenant es 409 QA_RUN_ALREADY_ACTIVE', async () => {
    const { service, admission, query } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    query.activeRunsForTenant.mockResolvedValue(1);
    expect(await rejection(service.launch(user, launchInput(plan.planHash)))).toEqual({ status: 409, code: 'QA_RUN_ALREADY_ACTIVE' });
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('el reintento con la misma clave NO cuenta como segunda corrida activa: responde la ya aceptada', async () => {
    const { service, admission, query } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    admission.findByIdempotencyKey.mockResolvedValue({ _id: '42', plan_hash: plan.planHash, status: 'RUNNING' });
    admission.admit.mockResolvedValue({ runId: '42', status: 'RUNNING', replayed: true });
    query.activeRunsForTenant.mockResolvedValue(1);
    expect(await service.launch(user, launchInput(plan.planHash))).toEqual({ runId: '42', status: 'RUNNING' });
    expect(query.activeRunsForTenant).not.toHaveBeenCalled();
  });

  it('la clave reutilizada con otro plan es 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const { service, admission } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    admission.admit.mockResolvedValue({ conflict: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await rejection(service.launch(user, launchInput(plan.planHash)))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('admite con namespace nuevo por corrida derivado de la clave y la fecha de referencia de hoy', async () => {
    const { service, admission } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    expect(await service.launch(user, launchInput(plan.planHash))).toEqual({ runId: '42', status: 'QUEUED' });
    const [input] = admission.admit.mock.calls[0] as unknown as [Parameters<QaRunAdmissionRepository['admit']>[0]];
    expect(input).toMatchObject({ tenantId: '7', operatorId: '11', planId: '501', workflowCode: 'customer_full_lifecycle' });
    expect(input.namespace).toMatch(/^qa-[0-9a-z]+-23456789$/);
    expect(input.referenceDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('una clave sin alfanuméricos no deja el namespace vacío', async () => {
    const { service, admission } = build();
    const plan = stored();
    admission.findPlan.mockResolvedValue(plan);
    await service.launch(user, { planId: '501', planHash: plan.planHash, idempotencyKey: '--------' });
    const [input] = admission.admit.mock.calls[0] as unknown as [{ namespace: string }];
    expect(input.namespace).toMatch(/^qa-[0-9a-z]+-x$/);
  });
});

describe('orquestador de corridas QA: cancelación y capacidades', () => {
  it('cancelar un id no numérico o inexistente es 404; uno válido devuelve el estado nuevo', async () => {
    const { service, admission } = build();
    expect(await rejection(service.cancel(user, 'abc'))).toEqual({ status: 404, code: 'QA_RUN_NOT_FOUND' });
    expect(admission.requestCancel).not.toHaveBeenCalled();
    expect(await service.cancel(user, '42')).toEqual({ runId: '42', status: 'CANCELLING' });
    expect(admission.requestCancel).toHaveBeenCalledWith('7', '42');
    admission.requestCancel.mockResolvedValueOnce(null);
    expect(await rejection(service.cancel(user, '43'))).toEqual({ status: 404, code: 'QA_RUN_NOT_FOUND' });
  });

  it('capabilities junta worker, cola y mock; apagado no ofrece entornos', async () => {
    const { service, environments } = build();
    const abierto = await service.capabilities();
    expect(abierto).toMatchObject({
      enabled: true,
      disabledReason: null,
      deploymentEnvironment: 'TEST',
      environments: [policy],
      worker: { ready: true, activeRuns: 1, queuedRuns: 2 },
      mock: { reachable: true, schemaVersion: '2026-09', controlPlane: true },
    });
    environments.disabledReason.mockReturnValue('apagado');
    expect(await service.capabilities()).toMatchObject({ enabled: false, disabledReason: 'apagado', environments: [] });
  });
});
