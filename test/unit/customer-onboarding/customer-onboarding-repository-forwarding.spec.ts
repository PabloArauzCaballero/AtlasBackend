import { describe, expect, it } from '@jest/globals';
import { CustomerOnboardingRepository } from '../../../src/modules/customer-onboarding/customer-onboarding.repository.js';

/**
 * La fachada tiene que reenviar TODOS sus métodos, no la muestra que alguien recordó probar.
 *
 * Los casos escritos a mano de `customer-onboarding-repository-facade.spec.ts` fijan a qué
 * sub-repositorio va cada familia. Lo que falta —y es lo que se cuela en un refactor— es el método
 * que se añade a la fachada y se queda sin reenviar, o el que pierde un argumento por el camino.
 * Esta prueba recorre el prototipo entero, así que un método nuevo entra sola en su alcance.
 */
describe('CustomerOnboardingRepository — reenvío exhaustivo', () => {
  type Call = { repo: string; method: string; args: unknown[] };

  function doubles() {
    const calls: Call[] = [];
    const spy = (repo: string) =>
      new Proxy(
        {},
        {
          get:
            (_target, method: string) =>
            (...args: unknown[]) => {
              calls.push({ repo, method, args });
              return undefined;
            },
        },
      );
    const facade = new CustomerOnboardingRepository(
      spy('flow') as never,
      spy('contactVerification') as never,
      spy('identityEvidence') as never,
      spy('addressStatus') as never,
    );
    return { facade, calls };
  }

  const methodsOf = (): string[] =>
    Object.getOwnPropertyNames(CustomerOnboardingRepository.prototype).filter((name) => name !== 'constructor');

  const SENTINELS: unknown[] = ['arg-1', 'arg-2', 'arg-3', 'arg-4', { transaction: 'tx' }];

  it('expone métodos: si esta lista queda vacía, la prueba de abajo no estaría probando nada', () => {
    expect(methodsOf().length).toBeGreaterThan(15);
  });

  it.each(methodsOf())('%s reenvía al sub-repositorio con los mismos argumentos', (method) => {
    const { facade, calls } = doubles();

    (facade as unknown as Record<string, (...args: unknown[]) => unknown>)[method](...SENTINELS);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(method);
    // Ni reordena ni pierde argumentos: lo recibido es el prefijo exacto de lo enviado.
    expect(calls[0].args).toEqual(SENTINELS.slice(0, calls[0].args.length));
  });
});
