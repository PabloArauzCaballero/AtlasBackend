import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { asyncMock } from '../../support/jest-mocks.js';

/**
 * La COLA de trabajo salió de `OperationsService` a `OperationsWorkQueueService` (búsqueda `q`,
 * `summary.byType`, total en las variantes por cursor y el acceso sólo-fraude de `fraud_analyst`).
 * Las pruebas de paginación y mezcla vienen tal cual del spec del servicio original.
 */
jest.mock('../../../src/modules/operations/operations.mapper.js', () => ({
  toManualReviewWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string; customerId?: string }) => ({
    id: row.id,
    kind: 'manual_review',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
    ...(row.customerId ? { customerId: row.customerId } : {}),
  })),
  toFraudWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string }) => ({
    id: row.id,
    kind: 'fraud',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  })),
}));

function mockedIds(items: readonly unknown[]): Array<string | undefined> {
  return items.map((item) => (item as { id?: string }).id);
}

describe('OperationsWorkQueueService', () => {
  async function buildService() {
    const { OperationsWorkQueueService } = await import('../../../src/modules/operations/operations-work-queue.service.js');
    const operationsRepository = {
      findManualReviewCasesForQueueWithCursor: asyncMock(),
      findFraudCasesForQueueWithCursor: asyncMock(),
      findManualReviewCasesForQueue: asyncMock(),
      findFraudCasesForQueue: asyncMock(),
      countManualReviewCases: jest.fn(async (..._args: unknown[]) => 0),
      countFraudCases: jest.fn(async (..._args: unknown[]) => 0),
    };
    const customersRepository = { findManyByIds: jest.fn(async (..._args: unknown[]) => [] as unknown[]) };
    const service = new OperationsWorkQueueService(operationsRepository as never, customersRepository as never);
    return { service, operationsRepository, customersRepository };
  }

  describe('getManualReviewCasesCursorPage / getFraudCasesCursorPage', () => {
    it('getManualReviewCasesCursorPage maps items through toManualReviewWorkItem and forwards nextCursor unchanged', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueueWithCursor as jest.Mock).mockResolvedValueOnce({
        items: [{ id: '1', createdAt: '2026-01-01' }],
        nextCursor: 'cursor-abc',
      } as never);

      const result = await service.getManualReviewCasesCursorPage('t1', { limit: 20, sortBy: 'createdAt' } as never);

      expect(result.items).toEqual([{ id: '1', kind: 'manual_review', openedAt: undefined, createdAt: '2026-01-01' }]);
      expect(result.nextCursor).toBe('cursor-abc');
    });

    it('getFraudCasesCursorPage maps items through toFraudWorkItem, not toManualReviewWorkItem', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findFraudCasesForQueueWithCursor as jest.Mock).mockResolvedValueOnce({
        items: [{ id: '1', createdAt: '2026-01-01' }],
        nextCursor: null,
      } as never);

      const result = await service.getFraudCasesCursorPage('t1', { limit: 20, sortBy: 'createdAt' } as never);

      expect(result.items[0]).toMatchObject({ kind: 'fraud' });
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('getWorkQueue', () => {
    it('queue: "manual_review" only calls the manual-review repository, not the fraud one', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({ rows: [], meta: { total: 0 } } as never);

      await service.getWorkQueue('t1', { queue: 'manual_review', page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(operationsRepository.findManualReviewCasesForQueue).toHaveBeenCalledTimes(1);
      expect(operationsRepository.findFraudCasesForQueue).not.toHaveBeenCalled();
    });

    it('queue: "fraud" only calls the fraud repository, not the manual-review one', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({ rows: [], meta: { total: 0 } } as never);

      await service.getWorkQueue('t1', { queue: 'fraud', page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(operationsRepository.findFraudCasesForQueue).toHaveBeenCalledTimes(1);
      expect(operationsRepository.findManualReviewCasesForQueue).not.toHaveBeenCalled();
    });

    it('queue: "all" merges both sources, sorted desc by default, and paginates in the application layer', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' }],
        meta: { total: 1 },
      } as never);
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'f1', createdAt: '2026-01-03T00:00:00.000Z' }],
        meta: { total: 1 },
      } as never);

      const result = await service.getWorkQueue('t1', { queue: 'all', page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(mockedIds(result.items)).toEqual(['f1', 'm1']);
      expect(result.meta.total).toBe(2);
    });

    it('queue: "all" con sortBy=updatedAt mezcla por updatedAt (el campo con el que cada fuente recorta), no por openedAt', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'm1', createdAt: '2026-01-01T00:00:00.000Z', openedAt: '2026-01-09T00:00:00.000Z', updatedAtValue: new Date('2026-02-01T00:00:00.000Z') }],
        meta: { total: 1 },
      } as never);
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'f1', createdAt: '2026-01-03T00:00:00.000Z', openedAt: '2026-01-02T00:00:00.000Z', updatedAtValue: new Date('2026-02-05T00:00:00.000Z') }],
        meta: { total: 1 },
      } as never);

      const result = await service.getWorkQueue('t1', { queue: 'all', page: 1, limit: 20, sortBy: 'updatedAt', sortOrder: 'desc' } as never);

      expect(mockedIds(result.items)).toEqual(['f1', 'm1']);
    });

    it('queue: "all" rechaza una ventana page*limit sin techo antes de tocar la base', async () => {
      const { service, operationsRepository } = await buildService();

      await expect(service.getWorkQueue('t1', { queue: 'all', page: 100000, limit: 100, sortOrder: 'desc' } as never)).rejects.toThrow(
        'WORK_QUEUE_WINDOW_TOO_DEEP',
      );
      expect(operationsRepository.findManualReviewCasesForQueue).not.toHaveBeenCalled();
    });

    it('queue: "all" respects sortOrder: "asc" too — oldest first', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' }],
        meta: { total: 1 },
      } as never);
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'f1', createdAt: '2026-01-03T00:00:00.000Z' }],
        meta: { total: 1 },
      } as never);

      const result = await service.getWorkQueue('t1', { queue: 'all', page: 1, limit: 20, sortOrder: 'asc' } as never);

      expect(mockedIds(result.items)).toEqual(['m1', 'f1']);
    });

    it('queue: "all" slices to the requested page after merging, not before', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [
          { id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'm2', createdAt: '2026-01-02T00:00:00.000Z' },
        ],
        meta: { total: 2 },
      } as never);
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({
        rows: [
          { id: 'f1', createdAt: '2026-01-03T00:00:00.000Z' },
          { id: 'f2', createdAt: '2026-01-04T00:00:00.000Z' },
        ],
        meta: { total: 2 },
      } as never);

      const result = await service.getWorkQueue('t1', { queue: 'all', page: 2, limit: 2, sortOrder: 'desc' } as never);

      // merged+sorted desc: f2, f1, m2, m1 -> page 2 with limit 2 -> [m2, m1]
      expect(mockedIds(result.items)).toEqual(['m2', 'm1']);
    });

    it('queue: "all" asks each source for its top page*limit rows (offset 0), not the same page/limit as the caller', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCasesForQueue as jest.Mock).mockResolvedValueOnce({ rows: [], meta: { total: 0 } } as never);
      (operationsRepository.findFraudCasesForQueue as jest.Mock).mockResolvedValueOnce({ rows: [], meta: { total: 0 } } as never);

      await service.getWorkQueue('t1', { queue: 'all', page: 3, limit: 5, sortOrder: 'desc' } as never);

      // page*limit = 15: cada fuente debe pedirse con offset 0 (page: 1) y limit: 15, no page:3/limit:5 —
      // ver el comentario en operations.service.ts sobre por qué mezclar dos páginas ya recortadas es incorrecto.
      expect(operationsRepository.findManualReviewCasesForQueue).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ page: 1, limit: 15 }),
      );
      expect(operationsRepository.findFraudCasesForQueue).toHaveBeenCalledWith('t1', expect.objectContaining({ page: 1, limit: 15 }));
    });

    it('queue: "all" page 2+ returns the correct globally-sorted slice against sources that genuinely paginate (regression for the OFFSET-merge bug)', async () => {
      const { service, operationsRepository } = await buildService();

      // 5 manual-review cases + 3 fraud cases, already sorted desc by createdAt like the real
      // repository would return them. Merged+sorted desc, the true order is:
      // [m1(10), f1(9), m2(8), m3(6), f2(5), m4(4), m5(2), f3(1)]
      const manualRows = [
        { id: 'm1', createdAt: '2026-01-10T00:00:00.000Z' },
        { id: 'm2', createdAt: '2026-01-08T00:00:00.000Z' },
        { id: 'm3', createdAt: '2026-01-06T00:00:00.000Z' },
        { id: 'm4', createdAt: '2026-01-04T00:00:00.000Z' },
        { id: 'm5', createdAt: '2026-01-02T00:00:00.000Z' },
      ];
      const fraudRows = [
        { id: 'f1', createdAt: '2026-01-09T00:00:00.000Z' },
        { id: 'f2', createdAt: '2026-01-05T00:00:00.000Z' },
        { id: 'f3', createdAt: '2026-01-01T00:00:00.000Z' },
      ];

      // Fake que respeta offset/limit de verdad, como haría Postgres — a diferencia de los demás
      // tests de este describe (que usan mockResolvedValueOnce con datos fijos, ignorando los
      // argumentos), esto es lo que hacía que el bug original pasara desapercibido.
      operationsRepository.findManualReviewCasesForQueue.mockImplementation(async (...args: unknown[]) => {
        const query = args[1] as { page: number; limit: number };
        const offset = (query.page - 1) * query.limit;
        return { rows: manualRows.slice(offset, offset + query.limit), meta: { total: manualRows.length } };
      });
      operationsRepository.findFraudCasesForQueue.mockImplementation(async (...args: unknown[]) => {
        const query = args[1] as { page: number; limit: number };
        const offset = (query.page - 1) * query.limit;
        return { rows: fraudRows.slice(offset, offset + query.limit), meta: { total: fraudRows.length } };
      });

      const page1 = await service.getWorkQueue('t1', { queue: 'all', page: 1, limit: 2, sortOrder: 'desc' } as never);
      const page2 = await service.getWorkQueue('t1', { queue: 'all', page: 2, limit: 2, sortOrder: 'desc' } as never);
      const page3 = await service.getWorkQueue('t1', { queue: 'all', page: 3, limit: 2, sortOrder: 'desc' } as never);
      const page4 = await service.getWorkQueue('t1', { queue: 'all', page: 4, limit: 2, sortOrder: 'desc' } as never);

      expect(mockedIds(page1.items)).toEqual(['m1', 'f1']);
      expect(mockedIds(page2.items)).toEqual(['m2', 'm3']);
      expect(mockedIds(page3.items)).toEqual(['f2', 'm4']);
      expect(mockedIds(page4.items)).toEqual(['m5', 'f3']);
      expect(page1.meta.total).toBe(8);

      // Ninguna página debe repetir ni saltarse ids frente a las demás.
      const allIds = [page1, page2, page3, page4].flatMap((p) => mockedIds(p.items));
      expect(new Set(allIds).size).toBe(8);
    });
  });

  describe('summary.byType, total por cursor y código de cliente', () => {
    it('queue "all" devuelve cuántos casos hay de cada cola, del servidor y no de la página', async () => {
      const { service, operationsRepository } = await buildService();
      operationsRepository.findManualReviewCasesForQueue.mockResolvedValueOnce({ rows: [], meta: { total: 12 } } as never);
      operationsRepository.findFraudCasesForQueue.mockResolvedValueOnce({ rows: [], meta: { total: 3 } } as never);
      const result = await service.getWorkQueue(
        't1',
        { queue: 'all', page: 1, limit: 20, sortOrder: 'desc' } as never,
        'internal_operator',
      );
      expect(result.summary).toEqual({ byType: { manual_review: 12, fraud: 3 } });
    });

    it('queue "manual_review" cuenta también el fraude con los MISMOS filtros (para la pestaña)', async () => {
      const { service, operationsRepository } = await buildService();
      operationsRepository.findManualReviewCasesForQueue.mockResolvedValueOnce({ rows: [], meta: { total: 4 } } as never);
      operationsRepository.countFraudCases.mockResolvedValueOnce(7);
      const query = { queue: 'manual_review', q: 'CUS-1', page: 1, limit: 20, sortOrder: 'desc' };
      const result = await service.getWorkQueue('t1', query as never, 'risk_analyst');
      expect(operationsRepository.countFraudCases).toHaveBeenCalledWith('t1', query);
      expect(result.summary.byType).toEqual({ manual_review: 4, fraud: 7 });
    });

    it('las variantes por cursor traen el total de lo que cumple los filtros', async () => {
      const { service, operationsRepository } = await buildService();
      operationsRepository.findFraudCasesForQueueWithCursor.mockResolvedValueOnce({ items: [], nextCursor: null } as never);
      operationsRepository.countFraudCases.mockResolvedValueOnce(41);
      const result = await service.getFraudCasesCursorPage('t1', { limit: 20, sortBy: 'createdAt' } as never);
      expect(result.total).toBe(41);
    });

    it('resuelve el código del cliente de toda la página en UNA consulta', async () => {
      const { service, operationsRepository, customersRepository } = await buildService();
      operationsRepository.findManualReviewCasesForQueue.mockResolvedValueOnce({
        rows: [
          { id: 'm1', createdAt: '2026-01-01', customerId: '9' },
          { id: 'm2', createdAt: '2026-01-02', customerId: '9' },
        ],
        meta: { total: 2 },
      } as never);
      customersRepository.findManyByIds.mockResolvedValueOnce([{ id: '9', customerCode: 'CUS-9' }]);
      const result = await service.getWorkQueue('t1', { queue: 'manual_review', page: 1, limit: 20, sortOrder: 'desc' } as never);
      expect(customersRepository.findManyByIds).toHaveBeenCalledTimes(1);
      expect(customersRepository.findManyByIds).toHaveBeenCalledWith('t1', ['9']);
      expect(result.items.map((item) => item.customerCode)).toEqual(['CUS-9', 'CUS-9']);
    });
  });

  describe('fraud_analyst sólo ve la cola de fraude', () => {
    it.each(['all', 'manual_review'])('queue "%s" responde 403 y no toca la revisión manual', async (queue) => {
      const { service, operationsRepository } = await buildService();
      await expect(service.getWorkQueue('t1', { queue, page: 1, limit: 20, sortOrder: 'desc' } as never, 'fraud_analyst')).rejects.toThrow(
        ForbiddenException,
      );
      expect(operationsRepository.findManualReviewCasesForQueue).not.toHaveBeenCalled();
      expect(operationsRepository.countManualReviewCases).not.toHaveBeenCalled();
    });

    it('queue "fraud": ve sus casos y su resumen NO trae la revisión manual (ni como cero)', async () => {
      const { service, operationsRepository } = await buildService();
      operationsRepository.findFraudCasesForQueue.mockResolvedValueOnce({
        rows: [{ id: 'f1', createdAt: '2026-01-01' }],
        meta: { total: 1 },
      } as never);
      const result = await service.getWorkQueue('t1', { queue: 'fraud', page: 1, limit: 20, sortOrder: 'desc' } as never, 'fraud_analyst');
      expect(mockedIds(result.items)).toEqual(['f1']);
      expect(result.summary.byType).toEqual({ fraud: 1 });
      expect(operationsRepository.countManualReviewCases).not.toHaveBeenCalled();
    });

    it('cualquier otro rol en queue "fraud" sí recibe la cifra de revisión manual', async () => {
      const { service, operationsRepository } = await buildService();
      operationsRepository.findFraudCasesForQueue.mockResolvedValueOnce({ rows: [], meta: { total: 2 } } as never);
      operationsRepository.countManualReviewCases.mockResolvedValueOnce(5);
      const result = await service.getWorkQueue('t1', { queue: 'fraud', page: 1, limit: 20, sortOrder: 'desc' } as never, 'admin');
      expect(result.summary.byType).toEqual({ fraud: 2, manual_review: 5 });
    });
  });
});
