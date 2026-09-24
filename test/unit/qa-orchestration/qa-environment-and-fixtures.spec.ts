import { env } from '../../../src/config/env';
import type { QaTransport, TransportRequest, TransportResponse } from '../../../src/modules/qa-orchestration/application/executor.ports';
import { QaEnvironmentService, workerLivenessSeconds } from '../../../src/modules/qa-orchestration/application/qa-environment';
import { requestedAmountFor, resolveFixtures } from '../../../src/modules/qa-orchestration/application/qa-run-fixtures';
import { ACCOUNT_SIGNUP_TO_LOGIN } from '../../../src/modules/qa-orchestration/catalog/customer-account.recipes';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import type { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';

type Mutable = Record<string, unknown>;

/** `env` se congela al importarse: se muta el MISMO objeto que ve el servicio y se restaura después. */
const ENV_KEYS = [
  'QA_EXECUTION_SECRET',
  'QA_TARGET_BASE_URL',
  'RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS',
  'MOCK_PROVIDERS_CONTROL_URL',
  'MOCK_PROVIDERS_CONTROL_TOKEN',
] as const;
const PROCESS_KEYS = ['QA_EXECUTION_ENABLED', 'ATLAS_DEPLOYMENT_ENVIRONMENT'] as const;

const savedEnv: Mutable = {};
const savedProcess: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = (env as Mutable)[key];
  for (const key of PROCESS_KEYS) savedProcess[key] = process.env[key];
  Object.assign(env as Mutable, {
    QA_EXECUTION_SECRET: 'secreto-de-pruebas-del-worker-qa-32-caracteres',
    QA_TARGET_BASE_URL: 'http://qa-backend.local/api/v1',
    RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS: 5_000,
    MOCK_PROVIDERS_CONTROL_URL: 'http://mock.local',
    MOCK_PROVIDERS_CONTROL_TOKEN: 'token-de-control',
  });
  process.env.QA_EXECUTION_ENABLED = 'true';
  process.env.ATLAS_DEPLOYMENT_ENVIRONMENT = 'TEST';
});

afterEach(() => {
  Object.assign(env as Mutable, savedEnv);
  for (const key of PROCESS_KEYS) {
    if (savedProcess[key] === undefined) delete process.env[key];
    else process.env[key] = savedProcess[key];
  }
  jest.restoreAllMocks();
});

function environmentService(workers = { count: 1, lastSeenAt: new Date('2026-09-24T10:00:00Z') }) {
  const query = { liveWorkers: jest.fn(async () => workers) };
  const service = new QaEnvironmentService(query as unknown as QaRunQueryRepository);
  const capabilities = jest
    .spyOn(service.mock, 'capabilities')
    .mockResolvedValue({ reachable: true, schemaVersion: '2026-09', scenarios: { SEGIP: ['happy_path'] } });
  return { service, query, capabilities };
}

describe('entorno QA administrado en el servidor', () => {
  it('un worker vive tres intervalos, con suelo de 30 s', () => {
    expect(workerLivenessSeconds()).toBe(30);
    (env as Mutable).RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS = 20_001;
    expect(workerLivenessSeconds()).toBe(61);
  });

  it('dice por qué no se puede ejecutar, en orden: PROD, apagado, sin secreto, sin destino', () => {
    const { service } = environmentService();
    expect(service.disabledReason()).toBeNull();
    (env as Mutable).QA_TARGET_BASE_URL = undefined;
    expect(service.disabledReason()).toContain('QA_TARGET_BASE_URL');
    (env as Mutable).QA_EXECUTION_SECRET = undefined;
    expect(service.disabledReason()).toContain('QA_EXECUTION_SECRET');
    process.env.QA_EXECUTION_ENABLED = 'false';
    expect(service.disabledReason()).toContain('QA_EXECUTION_ENABLED');
    process.env.ATLAS_DEPLOYMENT_ENVIRONMENT = 'PROD';
    expect(service.disabledReason()).toBe('Producción no admite corridas QA.');
  });

  it('publica un entorno con los topes de configuración y lo encuentra por id', () => {
    const { service } = environmentService();
    const [policy] = service.environments();
    expect(policy).toMatchObject({
      environmentId: env.QA_TARGET_ENVIRONMENT_ID,
      deploymentEnvironment: 'TEST',
      maxPersons: env.QA_MAX_PERSONS,
      limits: { maxRequests: env.QA_MAX_REQUESTS, maxDurationMs: env.QA_MAX_DURATION_MS },
    });
    expect(service.environment(env.QA_TARGET_ENVIRONMENT_ID)).toEqual(policy);
    expect(service.environment('otro')).toBeUndefined();
  });

  it('el catálogo del mock se cachea: dos sondeos seguidos lo consultan una vez', async () => {
    const { service, capabilities } = environmentService();
    await service.mockCapabilities();
    await service.mockCapabilities();
    expect(capabilities).toHaveBeenCalledTimes(1);
  });

  it('readiness: worker vivo y mock configurado; sin actores internos provisionados', async () => {
    const { service, query } = environmentService();
    expect(await service.readiness()).toEqual({
      workerReady: true,
      lastWorkerSeenAt: new Date('2026-09-24T10:00:00Z'),
      mockReachable: true,
      mockScenarios: { SEGIP: ['happy_path'] },
      availableActors: [],
    });
    expect(query.liveWorkers).toHaveBeenCalledWith(30);
  });

  it('readiness: un worker que late en un entorno apagado no está listo; sin token de control el mock no cuenta', async () => {
    (env as Mutable).MOCK_PROVIDERS_CONTROL_TOKEN = undefined;
    const { service } = environmentService();
    process.env.QA_EXECUTION_ENABLED = 'false';
    expect(await service.readiness()).toMatchObject({ workerReady: false, mockReachable: false });
    const sinWorkers = environmentService({ count: 0, lastSeenAt: new Date(0) }).service;
    process.env.QA_EXECUTION_ENABLED = 'true';
    expect((await sinWorkers.readiness()).workerReady).toBe(false);
  });
});

function transport(response: TransportResponse): QaTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      return response;
    },
  };
}

const withFixtures = (fixtures: JourneyTemplate['fixtures']): JourneyTemplate => ({ ...ACCOUNT_SIGNUP_TO_LOGIN, fixtures });
const signal = new AbortController().signal;
const noProduct = async () => null;

describe('fixtures de una corrida QA', () => {
  it('los consentimientos salen del catálogo real y se otorgan todos', async () => {
    const http = transport({
      status: 200,
      body: {
        data: [
          { id: 1, documentCode: 'terms' },
          { id: 2, documentCode: 'privacy' },
        ],
      },
      latencyMs: 3,
    });
    const result = await resolveFixtures(withFixtures(['consents']), { transport: http, creditProduct: noProduct, signal });
    expect(result).toMatchObject({
      ok: true,
      fixtures: {
        signupConsents: [
          { consentDocumentId: '1', purposeCode: 'terms', granted: true },
          { consentDocumentId: '2', purposeCode: 'privacy', granted: true },
        ],
      },
    });
    expect(http.calls[0]).toMatchObject({ method: 'GET', path: '/consent-documents/active', signal });
  });

  it('un catálogo vacío, con error o sin respuesta bloquea con su motivo', async () => {
    const vacio = await resolveFixtures(withFixtures(['consents']), {
      transport: transport({ status: 200, body: { data: [] }, latencyMs: 1 }),
      creditProduct: noProduct,
      signal,
    });
    expect(vacio).toMatchObject({ ok: false, missing: 'consents', message: expect.stringContaining('HTTP 200') });
    const caido = await resolveFixtures(withFixtures(['consents']), {
      transport: transport({ status: 500, body: { data: [{ id: 1 }] }, latencyMs: 1 }),
      creditProduct: noProduct,
      signal,
    });
    expect(caido).toMatchObject({ ok: false, missing: 'consents' });
    const sinRespuesta = await resolveFixtures(withFixtures(['consents']), {
      transport: transport({ status: null, error: 'TIMEOUT', latencyMs: 1 }),
      creditProduct: noProduct,
      signal,
    });
    expect(sinRespuesta).toMatchObject({ ok: false, message: expect.stringContaining('sin respuesta') });
  });

  it('el producto de crédito se resuelve por consulta; sin producto activo bloquea', async () => {
    const http = transport({ status: 200, body: {}, latencyMs: 1 });
    const product = { id: '3', minAmount: 500, maxAmount: 20_000 };
    expect(
      await resolveFixtures(withFixtures(['creditProduct']), { transport: http, creditProduct: async () => product, signal }),
    ).toMatchObject({
      ok: true,
      fixtures: { creditProductId: '3', creditProduct: product },
    });
    expect(await resolveFixtures(withFixtures(['creditProduct']), { transport: http, creditProduct: noProduct, signal })).toMatchObject({
      ok: false,
      missing: 'creditProduct',
    });
    expect(http.calls).toHaveLength(0);
  });

  it('un actor interno o de comercio sin provisionar bloquea en vez de usar la sesión del operador', async () => {
    const http = transport({ status: 200, body: {}, latencyMs: 1 });
    expect(await resolveFixtures(withFixtures(['internalActor']), { transport: http, creditProduct: noProduct, signal })).toMatchObject({
      ok: false,
      missing: 'internalActor',
      message: expect.stringContaining('interno'),
    });
    expect(await resolveFixtures(withFixtures(['merchantActor']), { transport: http, creditProduct: noProduct, signal })).toMatchObject({
      ok: false,
      message: expect.stringContaining('de comercio'),
    });
    expect(await resolveFixtures(withFixtures([]), { transport: http, creditProduct: noProduct, signal })).toMatchObject({
      ok: true,
      fixtures: {},
    });
  });

  it('el monto pedido es dos ingresos, dentro de los límites del producto o de 500–20 000', () => {
    expect(requestedAmountFor(3_000, { minAmount: 1_000, maxAmount: 5_000 })).toBe(5_000);
    expect(requestedAmountFor(100, { minAmount: 1_000, maxAmount: 5_000 })).toBe(1_000);
    expect(requestedAmountFor(2_000.4, undefined)).toBe(4_001);
    expect(requestedAmountFor(100, undefined)).toBe(500);
    expect(requestedAmountFor(50_000, undefined)).toBe(20_000);
  });
});
