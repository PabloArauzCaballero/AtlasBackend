import { afterEach, describe, expect, it } from '@jest/globals';
import { appRole, deliversNotificationsInProcess, runsBackgroundWork, runsHttpApi } from '../../../src/config/app-role.js';
import { env } from '../../../src/config/env.js';

/**
 * El rol del proceso decide qué arranca y qué no. Un error aquí no se manifiesta como una excepción
 * sino como trabajo que deja de ocurrir en silencio —el outbox sin despachar, la retención de datos
 * personales sin aplicar—, así que la tabla de verdad se fija explícitamente en vez de deducirse.
 *
 * `env` es un objeto plano no congelado: se muta y se restaura por prueba.
 */
describe('app-role', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const original = { APP_ROLE: mutableEnv['APP_ROLE'], NOTIFICATIONS_DELIVERY_MODE: mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] };

  afterEach(() => {
    mutableEnv['APP_ROLE'] = original.APP_ROLE;
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = original.NOTIFICATIONS_DELIVERY_MODE;
  });

  it('el default es "all": sin configurar nada, un solo proceso hace ambas cosas', () => {
    expect(original.APP_ROLE).toBe('all');
  });

  // Sin `as const`: `it.each` exige tuplas mutables, y el tipo del rol se fija en la firma del
  // callback — que es donde importa que sea el union real y no `string`.
  it.each([
    ['api', { http: true, background: false }],
    ['worker', { http: false, background: true }],
    ['all', { http: true, background: true }],
  ])('rol %s → http=%o', (role, expected) => {
    mutableEnv['APP_ROLE'] = role;

    expect(appRole()).toBe(role);
    expect(runsHttpApi()).toBe(expected.http);
    expect(runsBackgroundWork()).toBe(expected.background);
  });

  describe('entrega de notificaciones', () => {
    it('en modo inline entrega siempre en el propio proceso, sea cual sea el rol', () => {
      mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'inline';
      for (const role of ['api', 'worker', 'all']) {
        mutableEnv['APP_ROLE'] = role;
        expect(deliversNotificationsInProcess()).toBe(true);
      }
    });

    it('en modo deferred la API NO entrega: deja los mensajes al worker', () => {
      mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'deferred';
      mutableEnv['APP_ROLE'] = 'api';

      expect(deliversNotificationsInProcess()).toBe(false);
    });

    it('en modo deferred el worker sí entrega: no tiene a quién diferirle el trabajo', () => {
      mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'deferred';

      mutableEnv['APP_ROLE'] = 'worker';
      expect(deliversNotificationsInProcess()).toBe(true);

      // `all` también, y por eso ninguna combinación de rol y modo deja mensajes sin dueño.
      mutableEnv['APP_ROLE'] = 'all';
      expect(deliversNotificationsInProcess()).toBe(true);
    });
  });
});
