import { describe, expect, it, jest } from '@jest/globals';
import { JobTickGuard } from '../../../src/modules/runtime-jobs/job-tick-guard.js';

/**
 * `setInterval` dispara pase lo que pase. Estas pruebas fijan las dos garantías que el planificador
 * necesita y que el temporizador no da por sí solo: que una tanda no se solape consigo misma, y que
 * una tanda atascada deje de ser silencio y pase a ser una señal.
 *
 * El reloj y el temporizador se inyectan para que la suite no dependa de tiempo real.
 */
describe('JobTickGuard', () => {
  /** Temporizador manual: se dispara cuando la prueba lo decide, no cuando pasa el tiempo. */
  function manualTimer() {
    const pending: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
    const setTimer = (callback: () => void, ms: number) => {
      const entry = { callback, ms, cleared: false };
      pending.push(entry);
      return {
        clear: () => {
          entry.cleared = true;
        },
      };
    };
    const fireAll = () => {
      for (const entry of pending) if (!entry.cleared) entry.callback();
    };
    return { setTimer, pending, fireAll };
  }

  function deferred() {
    let release = (): void => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release: () => release() };
  }

  it('ejecuta el handler y reporta completed', async () => {
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn() });
    const handler = jest.fn(async (..._args: unknown[]) => undefined);

    await expect(guard.run('process_events', handler)).resolves.toBe('completed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('no deja escapar el error del handler: lo traduce a failed', async () => {
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn() });

    // Un throw dentro de un tick de setInterval se convertiría en unhandledRejection, y los
    // handlers globales del proceso responden a eso matando el proceso. Un job que falla no puede
    // tumbar el worker entero.
    await expect(
      guard.run('process_events', async () => {
        throw new Error('deadlock');
      }),
    ).resolves.toBe('failed');
  });

  it('se salta la tanda mientras haya otra en vuelo del mismo job', async () => {
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn() });
    const first = deferred();
    const second = jest.fn(async (..._args: unknown[]) => undefined);

    const running = guard.run('process_events', () => first.promise);
    const outcome = await guard.run('process_events', second);

    expect(outcome).toBe('skipped_overlap');
    expect(second).not.toHaveBeenCalled();

    first.release();
    await running;
  });

  it('jobs distintos no se bloquean entre sí', async () => {
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn() });
    const blocked = deferred();
    const other = jest.fn(async (..._args: unknown[]) => undefined);

    const running = guard.run('process_events', () => blocked.promise);
    const outcome = await guard.run('apply_retention_policies', other);

    expect(outcome).toBe('completed');
    expect(other).toHaveBeenCalledTimes(1);

    blocked.release();
    await running;
  });

  it('libera el hueco al terminar, incluso si el handler falló', async () => {
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn() });

    await guard.run('process_events', async () => {
      throw new Error('boom');
    });

    expect(guard.isRunning('process_events')).toBe(false);
    await expect(guard.run('process_events', async () => undefined)).resolves.toBe('completed');
  });

  it('avisa una sola vez cuando la tanda supera el plazo, con el tiempo transcurrido', async () => {
    const timer = manualTimer();
    const onStall = jest.fn();
    let clock = 1_000;
    const guard = new JobTickGuard({ timeoutMs: 5_000, onStall, now: () => clock, setTimer: timer.setTimer });
    const blocked = deferred();

    const running = guard.run('apply_retention_policies', () => blocked.promise);
    clock = 9_000;
    timer.fireAll();

    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith({ jobCode: 'apply_retention_policies', elapsedMs: 8_000 });

    blocked.release();
    await running;
  });

  it('no avisa si la tanda termina antes del plazo: el watchdog se cancela', async () => {
    const timer = manualTimer();
    const onStall = jest.fn();
    const guard = new JobTickGuard({ timeoutMs: 5_000, onStall, setTimer: timer.setTimer });

    await guard.run('process_outbox', async () => undefined);
    timer.fireAll();

    expect(onStall).not.toHaveBeenCalled();
  });

  it('con timeoutMs=0 no arma ningún watchdog', async () => {
    const timer = manualTimer();
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn(), setTimer: timer.setTimer });

    await guard.run('process_outbox', async () => undefined);

    expect(timer.pending).toHaveLength(0);
  });

  it('una tanda atascada mantiene el hueco tomado: se prefiere un job detenido y ruidoso a uno duplicado', async () => {
    const timer = manualTimer();
    const guard = new JobTickGuard({ timeoutMs: 1_000, onStall: jest.fn(), setTimer: timer.setTimer });
    const stuck = deferred();

    const running = guard.run('process_events', () => stuck.promise);
    timer.fireAll();

    expect(guard.isRunning('process_events')).toBe(true);
    await expect(guard.run('process_events', async () => undefined)).resolves.toBe('skipped_overlap');

    stuck.release();
    await running;
  });

  it('runningForMs informa cuánto lleva la tanda en vuelo, y null si no hay ninguna', async () => {
    let clock = 100;
    const guard = new JobTickGuard({ timeoutMs: 0, onStall: jest.fn(), now: () => clock });
    const blocked = deferred();

    expect(guard.runningForMs('process_outbox')).toBeNull();

    const running = guard.run('process_outbox', () => blocked.promise);
    clock = 450;
    expect(guard.runningForMs('process_outbox')).toBe(350);

    blocked.release();
    await running;
    expect(guard.runningForMs('process_outbox')).toBeNull();
  });
});
