/**
 * @file AT-057 — la guarda de arranque del worker de Mensajería no se apaga sola.
 * @business Si el proceso arranca con la identidad del monolito (que sí lee Crédito y Clientes), la frontera
 *   de privilegios del piloto no existe. La guarda comprueba contra QUIÉN está conectado de verdad y aborta
 *   el arranque si no coincide o si falta la variable.
 * @system Doble de Sequelize (`authenticate`/`query`); sin base.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { MessagingDatabaseGuardService } from '../../../src/bootstrap/messaging-database-guard.service.js';
import { env } from '../../../src/config/env.js';
import type { Sequelize } from 'sequelize-typescript';

function guardWith(currentUser: string, options: { authenticateFails?: boolean } = {}) {
  const authenticate = jest.fn(async () => {
    if (options.authenticateFails) throw new Error('password authentication failed');
  });
  const query = jest.fn(async () => [{ u: currentUser }]);
  return new MessagingDatabaseGuardService({ authenticate, query } as unknown as Sequelize);
}

describe('guarda de base del worker de Mensajería', () => {
  const previous = env.MESSAGING_DB_USER;
  const setUser = (value: string | undefined) => {
    (env as { MESSAGING_DB_USER?: string }).MESSAGING_DB_USER = value;
  };

  it('conectado con la identidad esperada: el arranque continúa', async () => {
    setUser('atlas_ctx_messaging');
    await expect(guardWith('atlas_ctx_messaging').onModuleInit()).resolves.toBeUndefined();
    setUser(previous);
  });

  it('conectado con la identidad del monolito: aborta nombrando las dos identidades', async () => {
    setUser('atlas_ctx_messaging');
    await expect(guardWith('atlas_app_rw').onModuleInit()).rejects.toThrow(
      /MESSAGING_DB_IDENTITY_MISMATCH.*atlas_app_rw.*atlas_ctx_messaging/s,
    );
    setUser(previous);
  });

  it('sin la variable NO se salta la comprobación: aborta (antes arrancaba y lo daba por verificado)', async () => {
    setUser(undefined);
    await expect(guardWith('atlas_app_rw').onModuleInit()).rejects.toThrow(/MESSAGING_DB_USER_MISSING/);
    setUser(previous);
  });

  it('si la base no acepta la credencial, el fallo sale tal cual: readiness no miente', async () => {
    setUser('atlas_ctx_messaging');
    await expect(guardWith('atlas_ctx_messaging', { authenticateFails: true }).onModuleInit()).rejects.toThrow(/authentication failed/);
    setUser(previous);
  });
});
