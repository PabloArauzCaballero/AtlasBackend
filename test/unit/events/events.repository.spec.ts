import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';

// El repositorio deriva los códigos válidos del registro de eventos; lo mockeamos para controlar
// la rama "sin códigos registrados" y el mapeo de family/version en createEvent.
jest.mock('../../../src/modules/events/event-registry.js', () => ({
  listEventDefinitions: jest.fn(() => [{ code: 'customer.created' }, { code: 'customer.updated' }]),
  getEventDefinition: jest.fn((code: string) =>
    code === 'customer.created' ? { code, family: 'customer', version: 2, defaultPriority: 5 } : undefined,
  ),
}));

import { EventsRepository } from '../../../src/modules/events/events.repository.js';
import { getEventDefinition, listEventDefinitions } from '../../../src/modules/events/event-registry.js';

/**
 * Cobertura directa de `EventsRepository` (Fase 1.2 del plan 10/10): outbox de eventos con
 * idempotencia, listado con filtros, paginación por cursor de tupla, y reclamo de pendientes.
 * Servicio/controller lo mockean, así que sus ramas no se ejercitaban. Modelo + conexión mockeados.
 */
describe('EventsRepository', () => {
  function buildRepo() {
    const outboxModel = { findOne: asyncMock(), findAll: asyncMock(), create: asyncMock(), findAndCountAll: asyncMock() };
    const sequelize = { query: asyncMock(), transaction: asyncMock() };
    const repo = new EventsRepository(outboxModel as never, sequelize as never);
    return { repo, outboxModel, sequelize };
  }

  beforeEach(() => {
    (listEventDefinitions as jest.Mock).mockReturnValue([{ code: 'customer.created' }, { code: 'customer.updated' }] as never);
    (getEventDefinition as jest.Mock).mockImplementation((code: unknown) =>
      code === 'customer.created' ? ({ code, family: 'customer', version: 2, defaultPriority: 5 } as never) : (undefined as never),
    );
  });

  describe('createEvent', () => {
    it('con idempotencyKey y evento existente devuelve el existente sin crear', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findOne as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
      const result = await repo.createEvent({
        tenantId: 't1',
        aggregateType: 'customer',
        eventCode: 'customer.created',
        idempotencyKey: 'k1',
      } as never);
      expect(result).toEqual({ id: 'e1' });
      expect(outboxModel.create).not.toHaveBeenCalled();
    });

    it('crea con defaults (pending, attempts 0) y family/version de la definición', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.create as jest.Mock).mockResolvedValue({ id: 'e2' } as never);
      await repo.createEvent({
        tenantId: 't1',
        aggregateType: 'customer',
        aggregateId: 'c1',
        eventCode: 'customer.created',
        payload: {},
      } as never);
      expect((outboxModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        eventFamily: 'customer',
        eventVersion: 2,
        priority: 5,
      });
    });

    it('para un código no catalogado usa family=uncatalogued y version=1', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.create as jest.Mock).mockResolvedValue({ id: 'e3' } as never);
      await repo.createEvent({ tenantId: 't1', aggregateType: 'x', eventCode: 'unknown.code', payload: {} } as never);
      expect((outboxModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
        eventFamily: 'uncatalogued',
        eventVersion: 1,
        priority: 0,
      });
    });

    it('si create falla sin idempotencyKey, relanza el error', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.create as jest.Mock).mockRejectedValue(new Error('boom') as never);
      await expect(repo.createEvent({ tenantId: 't1', aggregateType: 'x', eventCode: 'customer.created' } as never)).rejects.toThrow(
        'boom',
      );
    });

    it('si create falla con idempotencyKey y hay carrera, devuelve el existente', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findOne as jest.Mock).mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 'race' } as never);
      (outboxModel.create as jest.Mock).mockRejectedValue(new Error('unique') as never);
      const result = await repo.createEvent({
        tenantId: 't1',
        aggregateType: 'x',
        eventCode: 'customer.created',
        idempotencyKey: 'k9',
      } as never);
      expect(result).toEqual({ id: 'race' });
    });
  });

  describe('list', () => {
    it('aplica filtros opcionales y offset derivado de page/limit', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
      await repo.list('t1', { status: 'pending', eventCode: 'customer.created', page: 2, limit: 25 } as never);
      const arg = (outboxModel.findAndCountAll as jest.Mock).mock.calls[0][0] as {
        where: Record<string, unknown>;
        offset: number;
        limit: number;
      };
      expect(arg.where).toMatchObject({ tenantId: 't1', status: 'pending', eventCode: 'customer.created' });
      expect(arg.offset).toBe(25);
      expect(arg.limit).toBe(25);
    });
  });

  describe('listWithCursor', () => {
    it('sin cursor no añade la cláusula de tupla y pide limit+1', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.listWithCursor('t1', { page: 1, limit: 10 } as never, null);
      const arg = (outboxModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
      expect(arg.where[Op.and as unknown as string]).toBeUndefined();
      expect(arg.limit).toBe(11);
    });

    it('con cursor añade la comparación de tupla (created_at, id)', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.listWithCursor('t1', { page: 1, limit: 10 } as never, { createdAt: '2026-01-01T00:00:00Z', id: '50' });
      const where = callArg<CallArgRecord>(outboxModel.findAll, 0, 0).where as Record<string | symbol, unknown>;
      expect(where[Op.and as unknown as string]).toBeDefined();
    });
  });

  describe('getById', () => {
    it('devuelve el evento cuando existe', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findOne as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
      await expect(repo.getById('t1', 'e1')).resolves.toEqual({ id: 'e1' });
    });

    it('lanza NotFound cuando no existe', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findOne as jest.Mock).mockResolvedValue(null as never);
      await expect(repo.getById('t1', 'nope')).rejects.toThrow('EVENT_NOT_FOUND');
    });
  });

  describe('listPending', () => {
    it('corta en seco cuando no hay códigos registrados', async () => {
      const { repo, outboxModel } = buildRepo();
      (listEventDefinitions as jest.Mock).mockReturnValue([] as never);
      const result = await repo.listPending({ tenantId: 't1', limit: 10 });
      expect(result).toEqual([]);
      expect(outboxModel.findAll).not.toHaveBeenCalled();
    });

    it('filtra por status pending, Op.in de códigos y availableAt <= now; añade tenantId si se pasa', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.listPending({ tenantId: 't1', limit: 5 });
      const where = callArg<CallArgRecord>(outboxModel.findAll, 0, 0).where as Record<string, unknown>;
      expect(where.status).toBe('pending');
      expect((where.eventCode as Record<symbol, unknown>)[Op.in]).toEqual(['customer.created', 'customer.updated']);
      expect(where.tenantId).toBe('t1');
    });

    it('sin tenantId no añade el filtro de tenant', async () => {
      const { repo, outboxModel } = buildRepo();
      (outboxModel.findAll as jest.Mock).mockResolvedValue([] as never);
      await repo.listPending({ tenantId: null, limit: 5 });
      expect(callArg<CallArgRecord>(outboxModel.findAll, 0, 0).where.tenantId).toBeUndefined();
    });
  });

  describe('claimPending', () => {
    it('corta en seco cuando no hay códigos registrados (sin abrir transacción)', async () => {
      const { repo, sequelize } = buildRepo();
      (listEventDefinitions as jest.Mock).mockReturnValue([] as never);
      const result = await repo.claimPending({ tenantId: 't1', limit: 10, workerId: 'w1' });
      expect(result).toEqual([]);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('reclama vía SKIP LOCKED y recupera las filas bloqueadas por el worker', async () => {
      const { repo, outboxModel, sequelize } = buildRepo();
      (sequelize.transaction as jest.Mock).mockImplementation(async (cb: unknown) => (cb as (t: unknown) => unknown)('tx'));
      (sequelize.query as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
      (outboxModel.findAll as jest.Mock).mockResolvedValue([{ id: '1' }, { id: '2' }] as never);
      const result = await repo.claimPending({ tenantId: 't1', limit: 10, workerId: 'w1' });
      expect(result).toHaveLength(2);
      const findWhere = callArg<CallArgRecord>(outboxModel.findAll, 0, 0).where as unknown as {
        id: Record<symbol, unknown>;
        lockedBy: string;
      };
      expect(findWhere.id[Op.in]).toEqual(['1', '2']);
      expect(findWhere.lockedBy).toBe('w1');
    });

    it('devuelve [] sin segunda consulta cuando el UPDATE no reclamó nada', async () => {
      const { repo, outboxModel, sequelize } = buildRepo();
      (sequelize.transaction as jest.Mock).mockImplementation(async (cb: unknown) => (cb as (t: unknown) => unknown)('tx'));
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      const result = await repo.claimPending({ tenantId: null, limit: 10, workerId: 'w1' });
      expect(result).toEqual([]);
      expect(outboxModel.findAll).not.toHaveBeenCalled();
    });
  });
});
