import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { SystemsCatalogSeedService } from '../../../src/modules/systems-ops/systems-catalog-seed.service.js';

/**
 * `refreshCatalog` toma un candado consultivo de transacción. Si el INSERT del job lanzaba, la
 * transacción quedaba abierta con el candado y cada refresco respondía 409 hasta que Postgres cortaba
 * la sesión. Estas pruebas fijan que la transacción se suelta en todos los caminos.
 */
const USER = { sub: 'u-1', role: 'system_admin', tenantId: null } as never;
const INPUT = { includeTools: false, includeDataEntities: false, includeEndpointSeeds: false };

function build(options: { acquired?: boolean; createFails?: boolean } = {}) {
  const lockTransaction = {
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  };
  const sequelize = {
    transaction: jest.fn(async () => lockTransaction),
    query: jest.fn(async () => [{ acquired: options.acquired ?? true }]),
  };
  const job = { id: 7, status: 'running', save: jest.fn(async () => undefined) } as Record<string, unknown>;
  const jobRunModel = {
    create: jest.fn(async () => {
      if (options.createFails) throw new Error('connection reset');
      return job;
    }),
  };
  const service = new SystemsCatalogSeedService(
    sequelize as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    jobRunModel as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, lockTransaction, job };
}

describe('SystemsCatalogSeedService.refreshCatalog', () => {
  it('si el INSERT del job falla, suelta la transacción del candado y propaga el error', async () => {
    const { service, lockTransaction } = build({ createFails: true });
    await expect(service.refreshCatalog(INPUT, USER)).rejects.toThrow('connection reset');
    expect(lockTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(lockTransaction.commit).not.toHaveBeenCalled();
  });

  it('sin candado responde 409 y suelta la transacción', async () => {
    const { service, lockTransaction } = build({ acquired: false });
    await expect(service.refreshCatalog(INPUT, USER)).rejects.toBeInstanceOf(ConflictException);
    expect(lockTransaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('en el camino feliz cierra el job y confirma la transacción', async () => {
    const { service, lockTransaction, job } = build();
    const result = await service.refreshCatalog(INPUT, USER);
    expect(result).toMatchObject({ jobRunId: '7', tools: 0 });
    expect(job.status).toBe('succeeded');
    expect(lockTransaction.commit).toHaveBeenCalledTimes(1);
    expect(lockTransaction.rollback).not.toHaveBeenCalled();
  });
});
