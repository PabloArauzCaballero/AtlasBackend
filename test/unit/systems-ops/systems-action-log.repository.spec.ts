import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { SystemsActionLogRepository } from '../../../src/modules/systems-ops/systems-action-log.repository.js';

/**
 * Cobertura directa de `SystemsActionLogRepository` (Fase 1.2 del plan 10/10): listado de action logs
 * (where construido por util + rama tenantId null/valor), búsqueda por request, y dos consultas de
 * latencia por SQL crudo (agrupación por ruta y por buckets de tiempo). El util de where y el de
 * paginación son reales. Modelo + conexión mockeados.
 */
describe('SystemsActionLogRepository', () => {
  function buildRepo() {
    const actionLogModel = { findAndCountAll: asyncMock(), findAll: asyncMock() };
    const sequelize = { query: asyncMock() };
    const repo = new SystemsActionLogRepository(actionLogModel as never, sequelize as never);
    return { repo, actionLogModel, sequelize };
  }

  it('listActionLogs añade tenantId cuando no es null y calcula offset', async () => {
    const { repo, actionLogModel } = buildRepo();
    (actionLogModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listActionLogs({ method: 'GET', page: 3, limit: 20 } as never, 't1');
    const arg = (actionLogModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; offset: number };
    expect(arg.where).toMatchObject({ method: 'GET', tenantId: 't1' });
    expect(arg.offset).toBe(40);
  });

  it('listActionLogs con tenantId null no añade el filtro de tenant', async () => {
    const { repo, actionLogModel } = buildRepo();
    (actionLogModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listActionLogs({ page: 1, limit: 10 } as never, null);
    expect(callArg<CallArgRecord>(actionLogModel.findAndCountAll, 0, 0).where.tenantId).toBeUndefined();
  });

  it('listActionLogs traduce el rango from/to a occurredAt gte/lte', async () => {
    const { repo, actionLogModel } = buildRepo();
    (actionLogModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listActionLogs({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z', page: 1, limit: 10 } as never, null);
    const occurredAt = callArg<CallArgRecord>(actionLogModel.findAndCountAll, 0, 0).where.occurredAt as unknown as Record<symbol, Date>;
    expect(occurredAt[Op.gte]).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(occurredAt[Op.lte]).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('findActionLogsByRequest filtra por requestId + tenant y ordena desc', async () => {
    const { repo, actionLogModel } = buildRepo();
    (actionLogModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findActionLogsByRequest('req-1', 't1');
    const arg = (actionLogModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toEqual({ requestId: 'req-1', tenantId: 't1' });
    expect(arg.order).toEqual([['occurredAt', 'DESC']]);
  });

  it('getTrafficLatencyByRoute pasa fromDate y tenantId como replacements', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([] as never);
    const fromDate = new Date('2026-01-01');
    await repo.getTrafficLatencyByRoute(fromDate, null);
    const opts = (sequelize.query as jest.Mock).mock.calls[0][1] as { replacements: Record<string, unknown> };
    expect(opts.replacements).toEqual({ fromDate, tenantId: null });
  });

  it('getTrafficLatencyTimeseries convierte bucketMinutes a segundos en el replacement', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([] as never);
    const fromDate = new Date('2026-01-01');
    await repo.getTrafficLatencyTimeseries(fromDate, 15, 't1');
    const opts = (sequelize.query as jest.Mock).mock.calls[0][1] as { replacements: Record<string, unknown> };
    expect(opts.replacements).toEqual({ fromDate, bucketSeconds: 900, tenantId: 't1' });
  });
});
