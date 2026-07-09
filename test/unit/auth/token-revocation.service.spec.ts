import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';

/**
 * ATLAS-P10-013: cubre el comportamiento de caché agregado sobre `TokenRevocationService`
 * (lectura con hit/miss de Redis, degradación a base de datos si Redis falla o no está
 * configurado, y escritura write-through en `bumpTokenVersion`) — código de seguridad que antes
 * no tenía ningún test dedicado propio, solo cobertura indirecta vía `auth.service.spec.ts`.
 */

function buildCredentialModelMock(tokenVersion: number | null) {
  return {
    findOne: jest.fn(async () => (tokenVersion === null ? null : { tokenVersion, save: jest.fn(async () => undefined) })),
  };
}

function buildRedisMock() {
  return {
    get: jest.fn(async () => null as string | null),
    set: jest.fn(async () => 'OK'),
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
    const record = { tokenVersion: 4, save: jest.fn(async () => undefined) };
    const credentialModel = { findOne: jest.fn(async () => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    const newVersion = await service.bumpTokenVersion('customer', 'cust-1');

    expect(newVersion).toBe(5);
    expect(record.save).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('atlas:auth:token-version:customer:cust-1', '5', 'EX', 300);
  });

  it('bumpTokenVersion lanza error explícito si el actor no existe', async () => {
    const redis = buildRedisMock();
    const credentialModel = { findOne: jest.fn(async () => null) };
    const service = new TokenRevocationService(credentialModel as never, redis as never);

    await expect(service.bumpTokenVersion('customer', 'ghost')).rejects.toThrow('No existen credenciales para customer:ghost.');
  });

  it('bumpTokenVersion no lanza si la escritura en Redis falla (no bloqueante)', async () => {
    const redis = buildRedisMock();
    redis.set.mockRejectedValueOnce(new Error('Redis down'));
    const record = { tokenVersion: 1, save: jest.fn(async () => undefined) };
    const credentialModel = { findOne: jest.fn(async () => record) };

    const service = new TokenRevocationService(credentialModel as never, redis as never);
    await expect(service.bumpTokenVersion('customer', 'cust-9')).resolves.toBe(2);
  });
});
