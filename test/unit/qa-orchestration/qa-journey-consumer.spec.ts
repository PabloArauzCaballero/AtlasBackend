import { Logger } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import type { ClaimedJob } from '../../../src/platform/jobs/durable-job-queue';
import { QaJourneyConsumerService } from '../../../src/modules/qa-orchestration/application/qa-journey-consumer.service';
import type { ExecutionOutcome, QaRunExecutionService } from '../../../src/modules/qa-orchestration/application/qa-run-execution.service';
import type { QaRunSupportRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-support.repository';
import type { Fence } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-worker.repository';

const job: ClaimedJob = {
  jobRunId: '7001',
  jobCode: 'systems_qa_journey_run',
  tenantId: '7',
  inputJson: { qaRunId: '42' },
  attempt: 1,
  fencingToken: '3',
  leaseExpiresAt: new Date(Date.now() + 60_000),
};

type Execute = (runId: string, fence: Fence, signal: AbortSignal) => Promise<ExecutionOutcome>;

/** Espera a que la señal de la corrida se aborte y devuelve el abandono con SU motivo. */
const untilAborted: Execute = (_runId, _fence, signal) =>
  new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'ABANDONED', reason: String(signal.reason) })));

function build(execute: Execute, claimed: ClaimedJob | null = job) {
  const support = { workerHeartbeat: jest.fn(async () => undefined) };
  const execution = { execute: jest.fn(execute), failInfrastructure: jest.fn(async () => undefined) };
  const queue = {
    claim: jest.fn(async () => claimed),
    heartbeat: jest.fn(async () => true),
    complete: jest.fn(async () => true),
    release: jest.fn(async () => true),
  };
  const service = new QaJourneyConsumerService(
    {} as Sequelize,
    support as unknown as QaRunSupportRepository,
    execution as unknown as QaRunExecutionService,
  );
  // La cola durable se sustituye por un doble: aquí se prueba el ciclo de vida, no el SQL del claim.
  Object.assign(service, { queue });
  const active = () => (service as unknown as { active: Promise<string> | null }).active;
  return { service, support, execution, queue, active };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('consumidor de corridas QA', () => {
  it('sin trabajo en cola sólo late: el latido es la prueba de que el worker consume', async () => {
    const { service, support, execution } = build(untilAborted, null);
    expect(await service.drain()).toEqual({ claimed: 0, busy: false });
    expect(support.workerHeartbeat).toHaveBeenCalledWith(expect.stringMatching(/:\d+:[0-9a-f]{8}$/), expect.any(String));
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('reclama UNA corrida, no la espera en la tanda y no reclama otra mientras sigue en vuelo', async () => {
    let finish: (outcome: ExecutionOutcome) => void = () => undefined;
    const { service, queue, active, execution } = build(() => new Promise((resolve) => (finish = resolve)));
    expect(await service.drain()).toEqual({ claimed: 1, busy: true });
    expect(execution.execute).toHaveBeenCalledWith('42', { jobRunId: '7001', fencingToken: '3' }, expect.any(AbortSignal));
    expect(await service.drain()).toEqual({ claimed: 0, busy: true });
    expect(queue.claim).toHaveBeenCalledTimes(1);

    const running = active()!;
    finish({ kind: 'FINISHED', jobStatus: 'completed', runStatus: 'COMPLETED', verdict: 'PASSED' });
    expect(await running).toBe('COMPLETED');
    expect(queue.complete).toHaveBeenCalledWith(job, {
      status: 'completed',
      resultJson: { qaRunId: '42', runStatus: 'COMPLETED', verdict: 'PASSED' },
    });
    expect(active()).toBeNull();
  });

  it('un job cuyo cierre ya no confirma el lease se informa como LOST_LEASE', async () => {
    const { service, queue, active } = build(async () => ({
      kind: 'FINISHED',
      jobStatus: 'failed',
      runStatus: 'FAILED_INFRASTRUCTURE',
      verdict: null,
    }));
    queue.complete.mockResolvedValue(false);
    await service.drain();
    expect(await active()).toBe('LOST_LEASE');
  });

  it('un fallo inesperado cierra la corrida por infraestructura y el job como failed', async () => {
    const { service, queue, execution, active } = build(async () => {
      throw new Error('pool agotado');
    });
    await service.drain();
    expect(await active()).toBe('FAILED_INFRASTRUCTURE');
    expect(execution.failInfrastructure).toHaveBeenCalledWith('42', { jobRunId: '7001', fencingToken: '3' }, 'pool agotado');
    expect(queue.complete).toHaveBeenCalledWith(job, { status: 'failed', errorMessage: 'pool agotado' });
  });

  it('aunque cerrar por infraestructura también falle, el job se completa como failed', async () => {
    const { service, queue, execution, active } = build(async () => {
      throw new Error('boom');
    });
    execution.failInfrastructure.mockRejectedValueOnce(new Error('sin base'));
    queue.complete.mockRejectedValueOnce(new Error('sin base'));
    await service.drain();
    expect(await active()).toBe('FAILED_INFRASTRUCTURE');
  });

  it('al apagar se deja de admitir y la corrida vuelve a la cola para que otro worker la retome', async () => {
    const { service, queue, active } = build(untilAborted);
    await service.drain();
    const running = active()!;
    await service.onModuleDestroy();
    expect(await running).toBe('SHUTDOWN');
    expect(queue.release).toHaveBeenCalledWith(job);
    expect(queue.complete).not.toHaveBeenCalled();
    // Apagado: ya no se reclama nada más.
    expect(await service.drain()).toEqual({ claimed: 0, busy: false });
    expect(queue.claim).toHaveBeenCalledTimes(1);
  });

  it('si el latido del job descubre que otro worker la tomó, se abandona sin devolverla ni cerrarla', async () => {
    jest.useFakeTimers();
    const { service, queue, active } = build(untilAborted);
    queue.heartbeat.mockResolvedValue(false);
    await service.drain();
    const running = active()!;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await running).toBe('LOST_LEASE');
    expect(queue.release).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it('mientras conserva el lease, el latido renueva y la corrida sigue', async () => {
    jest.useFakeTimers();
    const { service, queue, support, active } = build(untilAborted);
    await service.drain();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(2);
    expect(support.workerHeartbeat).toHaveBeenCalledTimes(3);
    expect(active()).not.toBeNull();
    await service.onModuleDestroy();
  });

  it('un job sin qaRunId se ejecuta con id vacío y lo decide la ejecución', async () => {
    const { service, execution, active } = build(async () => ({ kind: 'ABANDONED', reason: 'LOST_LEASE' }), { ...job, inputJson: null });
    await service.drain();
    expect(await active()).toBe('LOST_LEASE');
    expect(execution.execute).toHaveBeenCalledWith('', expect.any(Object), expect.any(AbortSignal));
  });
});
