import { describe, expect, it } from '@jest/globals';
import { SessionsRepository } from '../../../src/modules/sessions/sessions.repository.js';

/**
 * Mismo control que en la fachada de onboarding: el reenvío completo, no una muestra.
 *
 * `SessionsRepository` reparte entre seis repositorios especializados (dispositivo, ciclo de vida,
 * ubicación, telemetría, vínculo con onboarding y actividad/auditoría). Los casos escritos a mano
 * fijan a cuál va cada familia; esto fija que no queda ninguno sin reenviar ni pierde argumentos por
 * el camino, que es el defecto que aparece cuando se añade un método y se olvida la fachada.
 */
describe('SessionsRepository — reenvío exhaustivo', () => {
  type Call = { method: string; args: unknown[] };

  function doubles() {
    const calls: Call[] = [];
    const spy = () =>
      new Proxy(
        {},
        {
          get:
            (_target, method: string) =>
            (...args: unknown[]) => {
              calls.push({ method, args });
              return undefined;
            },
        },
      );
    const repositories = Array.from({ length: 6 }, () => spy() as never);
    const facade = new SessionsRepository(...(repositories as [never, never, never, never, never, never]));
    return { facade, calls };
  }

  const methodsOf = (): string[] => Object.getOwnPropertyNames(SessionsRepository.prototype).filter((name) => name !== 'constructor');

  const SENTINELS: unknown[] = ['arg-1', 'arg-2', 'arg-3', 'arg-4', { transaction: 'tx' }];

  it('expone métodos: si esta lista queda vacía, la prueba de abajo no estaría probando nada', () => {
    expect(methodsOf().length).toBeGreaterThan(20);
  });

  it.each(methodsOf())('%s reenvía al sub-repositorio con los mismos argumentos', (method) => {
    const { facade, calls } = doubles();

    (facade as unknown as Record<string, (...args: unknown[]) => unknown>)[method](...SENTINELS);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(method);
    expect(calls[0].args).toEqual(SENTINELS.slice(0, calls[0].args.length));
  });
});
