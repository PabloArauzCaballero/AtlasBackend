/**
 * @file Unidad de trabajo local sobre Sequelize (AT-015).
 * @business Un caso de uso escribe varias cosas «o todas o ninguna» sin recibir la transacción del
 *   ORM ni poder usarla después de cerrada; la atomicidad es del adaptador, no del caso de uso.
 * @system Abre `sequelize.transaction`, construye una SESIÓN con puertos ya ligados a esa transacción
 *   y la entrega al callback. Al terminar (commit o rollback) la sesión se cierra: cualquier uso
 *   posterior lanza `UNIT_OF_WORK_CLOSED` y no escribe nada tarde. Nunca es global ni viaja por HTTP.
 */
import type { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

export class UnitOfWorkClosedError extends Error {
  constructor(member: string) {
    super(`UNIT_OF_WORK_CLOSED: la sesión terminó; «${member}» ya no puede usarse`);
    this.name = 'UnitOfWorkClosedError';
  }
}

/** Contrato que ven los casos de uso: un `run` con sesión tipada. Sin `Transaction` en ninguna firma. */
export interface LocalUnitOfWork<TSession extends object> {
  run<T>(work: (session: TSession) => Promise<T>): Promise<T>;
}

/**
 * Envuelve la sesión para que, cerrada la transacción, cualquier método lance en vez de escribir
 * fuera de ella. Se aplica en profundidad a los puertos que la sesión expone.
 */
function guard<T extends object>(target: T, state: { open: boolean }, path = 'session'): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      const member = `${path}.${String(property)}`;
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          if (!state.open) throw new UnitOfWorkClosedError(member);
          return (value as (...inner: unknown[]) => unknown).apply(object, args);
        };
      }
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) return guard(value as object, state, member);
      return value;
    },
  });
}

export abstract class SequelizeUnitOfWork<TSession extends object> implements LocalUnitOfWork<TSession> {
  protected constructor(private readonly sequelize: Sequelize) {}

  /** Construye la sesión con todos sus puertos ligados a `transaction`. Nunca exponer `transaction` en ella. */
  protected abstract bind(transaction: Transaction): TSession;

  async run<T>(work: (session: TSession) => Promise<T>): Promise<T> {
    const state = { open: true };
    try {
      return await this.sequelize.transaction(async (transaction) => work(guard(this.bind(transaction), state)));
    } finally {
      state.open = false;
    }
  }
}
