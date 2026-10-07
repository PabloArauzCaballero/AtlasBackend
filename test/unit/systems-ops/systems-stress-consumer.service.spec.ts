import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { ClaimedJob } from '../../../src/platform/jobs/durable-job-queue.js';
import { SystemsStressConsumerService } from '../../../src/modules/systems-ops/systems-stress-consumer.service.js';
import type { StressPlan } from '../../../src/modules/systems-ops/systems-stress-executor.service.js';

/**
 * Ciclo de vida del consumidor de estrés con la cola durable sustituida por un doble: aquí se prueba
 * qué pasa cuando el heartbeat FALLA y qué techos aplica el plan, no el SQL del claim (eso lo cubre
 * la integración `test/integration/jobs/systems-stress-consumer.spec.ts` contra PostgreSQL).
 */
const HEARTBEAT_MS = 15_000;

function claimed(input: Record<string, unknown> = {}): ClaimedJob {
  return {
    jobRunId: '9001',
    jobCode: 'systems_stress_run',
    tenantId: null,
    inputJson: { endpointId: '4', environment: 'LOCAL', dryRun: false, targetRps: 10, durationSeconds: 2, concurrency: 2, ...input },
    attempt: 1,
    fencingToken: '7',
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };
}

type Execute = (plan: StressPlan, signal: AbortSignal) => Promise<Record<string, unknown>>;

/** La corrida «dura» hasta que su señal se aborta: así el heartbeat tiene tiempo de latir. */
const untilAborted: Execute = (_plan, signal) =>
  new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('ABORTED'))));

function build(execute: Execute, job: ClaimedJob | null = claimed()) {
  const queue = {
    claim: jest.fn(async () => job),
    heartbeat: jest.fn(async (): Promise<boolean> => true),
    complete: jest.fn(async (..._args: unknown[]) => true),
  };
  const endpoints = {
    findByPk: jest.fn(async () => ({ backendBaseUrl: 'http://127.0.0.1:1', routePath: '/salud', method: 'GET' })),
  };
  const executor = { execute: jest.fn(execute) };
  const service = new SystemsStressConsumerService({} as never, endpoints as never, executor as never);
  Object.assign(service, { queue });
  return { service, queue, executor };
}

/** Avanza un latido y deja que se asienten las promesas que dispara. */
async function beat(times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
}

describe('SystemsStressConsumerService', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('un heartbeat que falla no deja un rechazo sin capturar y la corrida sigue', async () => {
    let finish: (report: Record<string, unknown>) => void = () => undefined;
    const { service, queue } = build(() => new Promise((resolve) => (finish = resolve)));
    queue.heartbeat.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    const draining = service.drain(new AbortController().signal);
    await beat(2);
    finish({ verdict: 'PASS' });

    await expect(draining).resolves.toEqual({ claimed: 1, completed: 1, failed: 0, lostLease: 0 });
    // Un turno real del bucle de eventos: es cuando Node emitiría `unhandledRejection`.
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    expect(queue.heartbeat).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Heartbeat de jobRun 9001 falló (1/3)'));
  });

  it('tres heartbeats fallidos seguidos cancelan la ejecución local', async () => {
    const { service, queue, executor } = build(untilAborted);
    queue.heartbeat.mockRejectedValue(new Error('pool agotado'));

    const draining = service.drain(new AbortController().signal);
    await beat(2);
    expect(executor.execute.mock.calls[0][1].aborted).toBe(false);
    await beat(1);

    await expect(draining).resolves.toEqual({ claimed: 1, completed: 0, failed: 1, lostLease: 0 });
    expect(queue.complete).toHaveBeenCalledWith(expect.anything(), { status: 'failed', errorMessage: 'ABORTED' });
    expect(unhandled).toEqual([]);
  });

  it('un heartbeat que vuelve a responder reinicia la cuenta de fallos', async () => {
    const { service, queue, executor } = build(untilAborted);
    const failure = new Error('corte breve');
    queue.heartbeat
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure);

    const shutdown = new AbortController();
    const draining = service.drain(shutdown.signal);
    await beat(5);
    expect(executor.execute.mock.calls[0][1].aborted).toBe(false);

    shutdown.abort();
    await expect(draining).resolves.toMatchObject({ claimed: 1, failed: 1 });
  });

  it('un heartbeat que dice que el lease se perdió cancela y el cierre rechazado cuenta como lease perdido', async () => {
    const { service, queue } = build(untilAborted);
    queue.heartbeat.mockResolvedValueOnce(false);
    queue.complete.mockResolvedValueOnce(false);

    const draining = service.drain(new AbortController().signal);
    await beat(1);

    await expect(draining).resolves.toEqual({ claimed: 1, completed: 0, failed: 0, lostLease: 1 });
  });

  it('el tope duro de peticiones y el timeout no se pueden subir desde `config`', async () => {
    const { service, executor } = build(
      async () => ({}),
      claimed({ targetRps: 10_000, durationSeconds: 86_400, config: { requestBudget: 999_999_999, timeoutMs: 3_600_000 } }),
    );
    await service.drain(new AbortController().signal);
    expect(executor.execute.mock.calls[0][0]).toMatchObject({ requestBudget: 50_000, timeoutMs: 60_000 });
  });

  it('un presupuesto menor que el techo se respeta, y sin `config` vale el plan recortado al techo', async () => {
    const lower = build(async () => ({}), claimed({ config: { requestBudget: 5, timeoutMs: 250 } }));
    await lower.service.drain(new AbortController().signal);
    expect(lower.executor.execute.mock.calls[0][0]).toMatchObject({ requestBudget: 5, timeoutMs: 250 });

    const byDefault = build(async () => ({}), claimed({ targetRps: 10, durationSeconds: 2 }));
    await byDefault.service.drain(new AbortController().signal);
    expect(byDefault.executor.execute.mock.calls[0][0]).toMatchObject({ requestBudget: 20, timeoutMs: 10_000 });

    const huge = build(async () => ({}), claimed({ targetRps: 10_000, durationSeconds: 3_600 }));
    await huge.service.drain(new AbortController().signal);
    expect(huge.executor.execute.mock.calls[0][0]).toMatchObject({ requestBudget: 50_000 });
  });

  it('sin trabajo en cola no ejecuta nada', async () => {
    const { service, executor } = build(async () => ({}), null);
    await expect(service.drain(new AbortController().signal)).resolves.toEqual({ claimed: 0, completed: 0, failed: 0, lostLease: 0 });
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
