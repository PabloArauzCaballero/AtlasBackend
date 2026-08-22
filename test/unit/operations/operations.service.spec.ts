import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de `operations`
 * Incluye la paginación por cursor que
 * `ATLAS-P11-T10` agregó a este mismo servicio sin test dedicado — deuda que este archivo cierra.
 */
jest.mock('../../../src/modules/operations/operations.mapper.js', () => ({
  toManualReviewWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string }) => ({
    id: row.id,
    kind: 'manual_review',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  })),
  toFraudWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string }) => ({
    id: row.id,
    kind: 'fraud',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  })),
  toInvestigationSummaryResponse: jest.fn((input: unknown) => ({ mapped: true, input })),
}));

/**
 * El mapper de `operations` está mockeado en este archivo, así que los items de la respuesta no son
 * `WorkQueueItemDto` reales sino los objetos que devuelve el mock (`{ id, kind, ... }`). Este helper
 * hace explícita esa diferencia en un solo lugar, en vez de repartir casts por cada aserción.
 */
function mockedIds(items: readonly unknown[]): Array<string | undefined> {
  return items.map((item) => (item as { id?: string }).id);
}

describe('OperationsService', () => {
  async function buildService() {
    const { OperationsService } = await import('../../../src/modules/operations/operations.service.js');
    const operationsRepository = {
      findManualReviewCasesForQueueWithCursor: asyncMock(),
      findFraudCasesForQueueWithCursor: asyncMock(),
      findManualReviewCasesForQueue: asyncMock(),
      findFraudCasesForQueue: asyncMock(),
      findOpenManualReviewCasesForCustomer: asyncMock(),
      findFraudCasesForCustomer: asyncMock(),
      findManualReviewCaseById: asyncMock(),
      closeManualReviewCase: asyncMock(),
      createManualReviewEvent: asyncMock(),
      createStatusEvent: asyncMock(),
      createCustomerObservation: asyncMock(),
      createOperationalAudit: asyncMock(),
      createDataChange: asyncMock(),
    };
    const customersRepository = {
      findById: asyncMock(),
      findCurrentProfile: asyncMock(),
      findContactMethods: asyncMock(),
      findCustomerConsents: asyncMock(),
    };
    const riskRepository = { findLatestCustomerRiskResult: asyncMock() };
    const lifecycleService = { transition: asyncMock() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new OperationsService(
      operationsRepository as never,
      customersRepository as never,
      // Los contactos del cliente viven en `CustomerContactsRepository`; el doble ya los expone.
      customersRepository as never,
      riskRepository as never,
      lifecycleService as never,
      sequelize as never,
    );
    return { service, operationsRepository, customersRepository, riskRepository, lifecycleService };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;

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

  describe('getInvestigationSummary', () => {
    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = await buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getInvestigationSummary('t1', { customerId: 'c1' } as never)).rejects.toThrow(NotFoundException);
    });
  });

  describe('decideManualReviewCase', () => {
    function baseInput(overrides: Record<string, unknown> = {}) {
      return {
        tenantId: 't1',
        params: { caseId: 'case-1' } as never,
        body: { decision: 'approved', reasonCode: 'r1' } as never,
        currentUser: internalUser,
        idempotencyKey: 'idem-1',
        ...overrides,
      };
    }

    it('throws BadRequestException without an idempotency key', async () => {
      const { service } = await buildService();
      await expect(service.decideManualReviewCase(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
    });

    it.each(['rejected', 'request_more_information'])(
      'throws DECISION_REASON_REQUIRED for decision "%s" without notes',
      async (decision) => {
        const { service } = await buildService();
        await expect(service.decideManualReviewCase(baseInput({ body: { decision, reasonCode: 'r1' } }))).rejects.toThrow(
          /DECISION_REASON_REQUIRED/,
        );
      },
    );

    it('does not require notes for "approved" or "no_action"', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      const result = await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

      expect(result.decision).toBe('approved');
    });

    it('throws CASE_NOT_FOUND when the case does not exist', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(/CASE_NOT_FOUND/);
    });

    it('throws CASE_ALREADY_CLOSED when closedAt is set', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({ closedAt: new Date(), status: 'open' } as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(ConflictException);
    });

    it('throws CASE_ALREADY_CLOSED when status is "closed" even if closedAt is somehow still null', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({ closedAt: null, status: 'closed' } as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(ConflictException);
    });

    /**
     * Regresión de H1. Antes, esta rama insertaba el evento de historial con `previousStatus: null`
     * y NUNCA actualizaba `customers.lifecycle_status`: el historial decía "aprobado" y el cliente
     * seguía en su estado anterior. La transición ahora la aplica `CustomerLifecycleService`, que
     * valida contra la máquina de estados y escribe estado + evento en la misma transacción.
     */
    it('aplica la transición REAL de estado vía CustomerLifecycleService, no solo un evento de historial', async () => {
      const { service, operationsRepository, lifecycleService } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);
      (lifecycleService.transition as jest.Mock).mockResolvedValueOnce({
        previousStatus: 'under_review',
        newStatus: 'active',
        changed: true,
      } as never);

      const result = await service.decideManualReviewCase(
        baseInput({ body: { decision: 'approved', reasonCode: 'r1', nextCustomerStatus: 'active' } }),
      );

      expect(lifecycleService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'c1', toStatus: 'active', reasonCode: 'r1', changedByInternalUserId: 'iu1' }),
      );
      // El evento de historial ya no se escribe aquí a mano: lo emite el servicio de ciclo de vida
      // junto con el UPDATE del estado, para que no puedan divergir.
      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
      expect(operationsRepository.createCustomerObservation).toHaveBeenCalledTimes(1);
      expect(result.nextCustomerStatus).toBe('active');
    });

    it('does NOT create a status event when nextCustomerStatus is missing, even if the case has a customerId', async () => {
      const { service, operationsRepository, lifecycleService } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);

      await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

      expect(lifecycleService.transition).not.toHaveBeenCalled();
      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
    });

    it('does NOT create a status event when the case has no customerId, even if nextCustomerStatus is given', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      await service.decideManualReviewCase(
        baseInput({ body: { decision: 'approved', reasonCode: 'r1', nextCustomerStatus: 'approved_for_next_step' } }),
      );

      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
    });

    it('always writes an operational audit entry and a data-change log entry, regardless of customerId', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      await service.decideManualReviewCase(baseInput());

      expect(operationsRepository.createOperationalAudit).toHaveBeenCalledTimes(1);
      expect(operationsRepository.createDataChange).toHaveBeenCalledTimes(1);
    });

    it('the response always reports caseStatus "closed"', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      const result = await service.decideManualReviewCase(baseInput());

      expect(result.caseStatus).toBe('closed');
    });
  });
});
