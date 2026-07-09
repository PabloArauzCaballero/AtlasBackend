import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de `operations`
 * (1,048 líneas, 0 tests hasta este patch). Incluye la paginación por cursor que
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

describe('OperationsService', () => {
  async function buildService() {
    const { OperationsService } = await import('../../../src/modules/operations/operations.service.js');
    const operationsRepository = {
      findManualReviewCasesForQueueWithCursor: jest.fn(),
      findFraudCasesForQueueWithCursor: jest.fn(),
      findManualReviewCasesForQueue: jest.fn(),
      findFraudCasesForQueue: jest.fn(),
      findOpenManualReviewCasesForCustomer: jest.fn(),
      findFraudCasesForCustomer: jest.fn(),
      findManualReviewCaseById: jest.fn(),
      closeManualReviewCase: jest.fn(),
      createManualReviewEvent: jest.fn(),
      createStatusEvent: jest.fn(),
      createCustomerObservation: jest.fn(),
      createOperationalAudit: jest.fn(),
      createDataChange: jest.fn(),
    };
    const customersRepository = {
      findById: jest.fn(),
      findCurrentProfile: jest.fn(),
      findContactMethods: jest.fn(),
      findCustomerConsents: jest.fn(),
    };
    const riskRepository = { findLatestCustomerRiskResult: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new OperationsService(
      operationsRepository as never,
      customersRepository as never,
      riskRepository as never,
      sequelize as never,
    );
    return { service, operationsRepository, customersRepository, riskRepository };
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

      expect(result.items.map((i: { id: string }) => i.id)).toEqual(['f1', 'm1']);
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

      expect(result.items.map((i: { id: string }) => i.id)).toEqual(['m1', 'f1']);
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
      expect(result.items.map((i: { id: string }) => i.id)).toEqual(['m2', 'm1']);
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

    it('creates a status event and observation ONLY when both customerId and nextCustomerStatus are present', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);

      await service.decideManualReviewCase(
        baseInput({ body: { decision: 'approved', reasonCode: 'r1', nextCustomerStatus: 'approved_for_next_step' } }),
      );

      expect(operationsRepository.createStatusEvent).toHaveBeenCalledTimes(1);
      expect(operationsRepository.createCustomerObservation).toHaveBeenCalledTimes(1);
      // ATLAS-AUDIT: changedByInternalUserId debe reflejar al actor real, no quedar null fijo.
      expect((operationsRepository.createStatusEvent as jest.Mock).mock.calls[0][0]).toEqual(
        expect.objectContaining({ actorInternalUserId: expect.anything() }),
      );
    });

    it('does NOT create a status event when nextCustomerStatus is missing, even if the case has a customerId', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);

      await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

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
