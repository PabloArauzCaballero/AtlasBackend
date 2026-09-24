import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { encryptSecret } from '../../../src/common/utils/crypto/secret-box.util';
import { QaContextMiddleware } from '../../../src/modules/qa-orchestration/infrastructure/qa-context.middleware';
import type { QaRunSupportRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-support.repository';
import type { QaRunWorkerRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-worker.repository';
import {
  currentQaContext,
  QA_EXECUTION_HEADER,
  signQaCredential,
  type ActiveQaContext,
  type QaCredentialClaims,
} from '../../../src/platform/security/qa-execution-context';

const SECRET = 'secreto-de-pruebas-del-worker-qa-32-caracteres';
const ENV_KEYS = ['QA_EXECUTION_SECRET', 'QA_EXECUTION_ENABLED', 'ATLAS_DEPLOYMENT_ENVIRONMENT'] as const;

const claims = (overrides: Partial<QaCredentialClaims> = {}): QaCredentialClaims => ({
  tenantId: '7',
  runId: '42',
  personaKey: 'p-0001',
  logicalOperationId: 'op-1',
  attempt: 2,
  environment: 'TEST',
  ...overrides,
});

type RunRow = Awaited<ReturnType<QaRunWorkerRepository['loadRun']>>;

/** Corrida viva del tenant 7 con namespace propio en el mock y su runToken cifrado. */
function fakes(run: Partial<NonNullable<RunRow>> | null = {}, token: string | null = encryptSecret('rt-mock')) {
  const runs = {
    loadRun: jest.fn(async () =>
      run === null ? null : ({ _id: '42', _tenant_id: '7', status: 'RUNNING', namespace: 'qa-ns-42', ...run } as RunRow),
    ),
  };
  const support = { readSecret: jest.fn(async () => ({ token, epoch: 'epoch-1' })) };
  const middleware = new QaContextMiddleware(runs as unknown as QaRunWorkerRepository, support as unknown as QaRunSupportRepository);
  return { runs, support, middleware };
}

/** Ejecuta el middleware y captura el contexto QA que ve el siguiente eslabón, DENTRO de `next`. */
async function pass(middleware: QaContextMiddleware, headers: Record<string, string>) {
  const request = { headers: { ...headers } } as unknown as Request;
  let seen: ActiveQaContext | undefined;
  let called = 0;
  await middleware.use(request, {} as Response, () => {
    called += 1;
    seen = currentQaContext();
  });
  return { seen, called, headers: request.headers };
}

describe('middleware de contexto QA', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.QA_EXECUTION_SECRET = SECRET;
    process.env.QA_EXECUTION_ENABLED = 'true';
    process.env.ATLAS_DEPLOYMENT_ENVIRONMENT = 'TEST';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('sin cabecera QA la petición sigue sin contexto y sin tocar la base', async () => {
    const { middleware, runs } = fakes();
    const result = await pass(middleware, { 'x-tenant-id': '7' });
    expect(result).toMatchObject({ called: 1, seen: undefined });
    expect(runs.loadRun).not.toHaveBeenCalled();
  });

  it('una firma mala no activa nada, y la cabecera se retira igual', async () => {
    const { middleware, runs } = fakes();
    const forged = signQaCredential(claims(), 'otro-secreto-que-no-es-el-del-backend-xx');
    const result = await pass(middleware, { [QA_EXECUTION_HEADER]: forged });
    expect(result.seen).toBeUndefined();
    expect(result.called).toBe(1);
    expect(result.headers).not.toHaveProperty(QA_EXECUTION_HEADER);
    expect(runs.loadRun).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('BAD_SIGNATURE'));
  });

  it('firma buena y corrida RUNNING: el contexto existe dentro de next con el namespace de la corrida', async () => {
    const { middleware } = fakes();
    const result = await pass(middleware, { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET), 'x-tenant-id': '7' });
    expect(result.called).toBe(1);
    expect(result.seen).toEqual({
      tenantId: '7',
      runId: 'qa-ns-42',
      runToken: 'rt-mock',
      personaKey: 'p-0001',
      logicalOperationId: 'op-1',
      attempt: 2,
      epoch: 'epoch-1',
    });
    expect(result.headers).not.toHaveProperty(QA_EXECUTION_HEADER);
    // Fuera de la petición el contexto no se filtra.
    expect(currentQaContext()).toBeUndefined();
  });

  it('una cabecera x-tenant-id distinta de la credencial deja la petición sin contexto', async () => {
    const { middleware, runs } = fakes();
    const result = await pass(middleware, { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET), 'x-tenant-id': '8' });
    expect(result.seen).toBeUndefined();
    expect(runs.loadRun).not.toHaveBeenCalled();
  });

  it('una corrida de otro tenant, no viva, inexistente o sin runToken no activa contexto', async () => {
    const header = { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET) };
    expect((await pass(fakes({ _tenant_id: '8' }).middleware, header)).seen).toBeUndefined();
    expect((await pass(fakes({ status: 'COMPLETED' }).middleware, header)).seen).toBeUndefined();
    expect((await pass(fakes(null).middleware, header)).seen).toBeUndefined();
    expect((await pass(fakes({}, null).middleware, header)).seen).toBeUndefined();
    expect((await pass(fakes({}, 'v1:roto:roto:roto').middleware, header)).seen).toBeUndefined();
  });

  it('CANCELLING sigue siendo viva: el tráfico aceptado se etiqueta hasta cerrar', async () => {
    const header = { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET) };
    expect((await pass(fakes({ status: 'CANCELLING' }).middleware, header)).seen?.runId).toBe('qa-ns-42');
  });

  it('si la base falla, la petición sigue sin contexto en vez de romperse', async () => {
    const { middleware, runs } = fakes();
    runs.loadRun.mockRejectedValueOnce(new Error('connection reset'));
    const result = await pass(middleware, { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET) });
    expect(result).toMatchObject({ called: 1, seen: undefined });
  });

  it('la corrida resuelta se cachea: diez peticiones seguidas leen la base una vez', async () => {
    const { middleware, runs, support } = fakes();
    const header = { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET) };
    for (let index = 0; index < 10; index += 1) expect((await pass(middleware, header)).seen?.runToken).toBe('rt-mock');
    expect(runs.loadRun).toHaveBeenCalledTimes(1);
    expect(support.readSecret).toHaveBeenCalledTimes(1);
  });

  it('con QA apagado o sin secreto no se verifica nada', async () => {
    const header = { [QA_EXECUTION_HEADER]: signQaCredential(claims(), SECRET) };
    process.env.QA_EXECUTION_ENABLED = 'false';
    const apagado = fakes();
    const result = await pass(apagado.middleware, header);
    expect(result.seen).toBeUndefined();
    expect(result.headers).not.toHaveProperty(QA_EXECUTION_HEADER);
    expect(apagado.runs.loadRun).not.toHaveBeenCalled();

    process.env.QA_EXECUTION_ENABLED = 'true';
    delete process.env.QA_EXECUTION_SECRET;
    expect((await pass(fakes().middleware, header)).seen).toBeUndefined();
  });

  it('una credencial emitida para otro entorno no vale en TEST', async () => {
    const { middleware, runs } = fakes();
    const result = await pass(middleware, { [QA_EXECUTION_HEADER]: signQaCredential(claims({ environment: 'STAGING' }), SECRET) });
    expect(result.seen).toBeUndefined();
    expect(runs.loadRun).not.toHaveBeenCalled();
  });
});
