import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';

/**
 * ATLAS-P10-013: cubre el comportamiento de caché agregado sobre `TokenRevocationService`
 * (lectura con hit/miss de Redis, degradación a base de datos si Redis falla o no está
 * configurado, y escritura write-through en `bumpTokenVersion`) — código de seguridad que antes
 * no tenía ningún test dedicado propio, solo cobertura indirecta vía `auth.service.spec.ts`.
 */

function buildCredentialModelMock(tokenVersion: number | null) {
  return {
    findOne: jest.fn(async (..._args: unknown[]) =>
      tokenVersion === null ? null : { tokenVersion, save: jest.fn(async (..._args: unknown[]) => undefined) },
    ),
  };
}

function buildRedisMock() {
  return {
    get: jest.fn(async (..._args: unknown[]) => null as string | null),
    set: jest.fn(async (..._args: unknown[]) => 'OK'),
    del: jest.fn(async (..._args: unknown[]) => 1),
  };
}

describe('TokenRevocationService — caché de tokenVersion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('en un hit de caché, devuelve el valor cacheado y NO consulta la base de datos', async () => {
    const redis = buildRedisMock();
    redis.get.mockResolvedValueOnce('7');
    const credentialModel = buildCredentialModelMock(999); // valor "trampa": si se leyera de DB, el test fallaría

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const version = await service.getCurrentTokenVersion('customer', 'cust-1');

    expect(version).toBe(7);
    expect(credentialModel.findOne).not.toHaveBeenCalled();
  });

  it('en un miss de caché, consulta la base de datos y escribe el resultado en Redis con TTL', async () => {
    const redis = buildRedisMock();
    redis.get.mockResolvedValueOnce(null);
    const credentialModel = buildCredentialModelMock(3);

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const version = await service.getCurrentTokenVersion('customer', 'cust-1');

    expect(version).toBe(3);
    expect(credentialModel.findOne).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('atlas:auth:token-version:customer:cust-1', '3', 'EX', 300);
  });

  it('si Redis falla en la lectura, se degrada a la base de datos sin lanzar error', async () => {
    const redis = buildRedisMock();
    redis.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    const credentialModel = buildCredentialModelMock(5);

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const version = await service.getCurrentTokenVersion('internal_user', 'user-1');

    expect(version).toBe(5);
    expect(credentialModel.findOne).toHaveBeenCalledTimes(1);
  });

  it('si Redis no está configurado (null), funciona solo contra la base de datos', async () => {
    const credentialModel = buildCredentialModelMock(1);
    const service = new TokenRevocationService(credentialModel as never, null);

    const version = await service.getCurrentTokenVersion('platform_user', 'user-2');

    expect(version).toBe(1);
  });

  it('devuelve null si no existen credenciales, sin escribir nada en caché', async () => {
    const redis = buildRedisMock();
    redis.get.mockResolvedValueOnce(null);
    const credentialModel = buildCredentialModelMock(null);

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const version = await service.getCurrentTokenVersion('customer', 'cust-404');

    expect(version).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('bumpTokenVersion incrementa en DB y escribe write-through en Redis de inmediato', async () => {
    const redis = buildRedisMock();
    const record = { tokenVersion: 4, save: jest.fn(async (..._args: unknown[]) => undefined) };
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const newVersion = await service.bumpTokenVersion('customer', 'cust-1');

    expect(newVersion).toBe(5);
    expect(record.save).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('atlas:auth:token-version:customer:cust-1', '5', 'EX', 300);
  });

  it('bumpTokenVersion lanza error explícito si el actor no existe', async () => {
    const redis = buildRedisMock();
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => null) };
    const service = new TokenRevocationService(credentialModel as never, redis as never);

    await expect(service.bumpTokenVersion('customer', 'ghost')).rejects.toThrow('No existen credenciales para customer:ghost.');
  });

  it('bumpTokenVersionIfPresent devuelve null en vez de lanzar cuando el actor no tiene credenciales', async () => {
    // Los llamantes que revocan como efecto secundario de un cambio de privilegios (suspender,
    // reemplazar roles) no deben romperse por un actor sin contraseña provisionada: sin fila en
    // `auth_credentials` no hay sesión que revocar.
    const redis = buildRedisMock();
    const credentialModel = { findOne: jest.fn(async () => null) };
    const service = new TokenRevocationService(credentialModel as never, redis as never);

    await expect(service.bumpTokenVersionIfPresent('internal_user', 'sin-credenciales')).resolves.toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('bumpTokenVersionIfPresent incrementa y hace write-through igual que bumpTokenVersion cuando el actor existe', async () => {
    const redis = buildRedisMock();
    const record = { tokenVersion: 8, save: jest.fn(async () => undefined) };
    const credentialModel = { findOne: jest.fn(async () => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);

    await expect(service.bumpTokenVersionIfPresent('internal_user', 'user-7')).resolves.toBe(9);
    expect(record.save).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('atlas:auth:token-version:internal_user:user-7', '9', 'EX', 300);
  });

  it('bumpTokenVersion no lanza si la escritura en Redis falla (no bloqueante)', async () => {
    const redis = buildRedisMock();
    redis.set.mockRejectedValueOnce(new Error('Redis down'));
    const record = { tokenVersion: 1, save: jest.fn(async (..._args: unknown[]) => undefined) };
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    await expect(service.bumpTokenVersion('customer', 'cust-9')).resolves.toBe(2);
  });

  /**
   * El agujero que cerraron estas tres pruebas.
   *
   * Un `SET` fallido NO deja la clave vacía: deja la ANTERIOR, con su TTL de cinco minutos. Como
   * `getCurrentTokenVersion` lee Redis primero, seguía sirviendo la versión vieja sin bajar a la
   * base, y el guard aceptaba un token ya revocado durante esa ventana. La prueba de arriba fijaba
   * únicamente que no se lanzara, así que el defecto convivía con la suite en verde.
   */
  it('si el write-through falla, BORRA la entrada en vez de dejar la versión vieja', async () => {
    const redis = buildRedisMock();
    redis.set.mockRejectedValueOnce(new Error('Redis down'));
    const record = { tokenVersion: 1, save: jest.fn(async (..._args: unknown[]) => undefined) };
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    await service.bumpTokenVersion('customer', 'cust-9');

    expect(redis.del).toHaveBeenCalledWith('atlas:auth:token-version:customer:cust-9');
  });

  it('tras esa invalidación, la lectura ve la versión NUEVA desde la base de datos', async () => {
    // La prueba de extremo a extremo del arreglo: es la secuencia real —revocar con Redis a medias
    // y volver a autenticarse— y es la que fallaba antes de borrar la clave.
    const store = new Map<string, string>([['atlas:auth:token-version:customer:cust-9', '1']]);
    const redis = {
      get: jest.fn(async (key: unknown) => store.get(key as string) ?? null),
      set: jest.fn(async (..._args: unknown[]) => {
        throw new Error('Redis down');
      }),
      del: jest.fn(async (key: unknown) => (store.delete(key as string) ? 1 : 0)),
    };
    const record = { tokenVersion: 1, save: jest.fn(async (..._args: unknown[]) => undefined) };
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    await service.bumpTokenVersionIfPresent('customer', 'cust-9');

    // El guard vería 2 (la revocada), no 1: el token viejo deja de valer.
    await expect(service.getCurrentTokenVersion('customer', 'cust-9')).resolves.toBe(2);
  });

  it('si tampoco se puede borrar, lo registra como ERROR y no como aviso', async () => {
    // Aquí queda una credencial revocada que la caché da por buena hasta su TTL. Si eso sale como
    // `warn` se pierde entre el ruido, y es justo lo que alguien tiene que ver.
    const redis = buildRedisMock();
    redis.set.mockRejectedValueOnce(new Error('Redis down'));
    redis.del.mockRejectedValueOnce(new Error('Redis down'));
    const record = { tokenVersion: 4, save: jest.fn(async (..._args: unknown[]) => undefined) };
    const credentialModel = { findOne: jest.fn(async (..._args: unknown[]) => record) };
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    await expect(service.bumpTokenVersion('internal_user', 'user-3')).resolves.toBe(5);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('internal_user:user-3');
    errorSpy.mockRestore();
  });
});
