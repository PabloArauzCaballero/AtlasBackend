import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FraudService } from '../../../src/modules/fraud/fraud.service.js';

/**
 * ATLAS-AUDIT-014: regresión para confirmar que mover `decideFraudCase` de
 * `OperationsService` a `FraudService` no cambió el comportamiento observable.
 */
function buildFraudRepositoryMock() {
  return {
    findFraudCaseById: jest.fn(),
    closeFraudCase: jest.fn(),
    createFraudCaseEvent: jest.fn(),
    createWatchlistEntry: jest.fn(),
    createStatusEvent: jest.fn(),
    createCustomerObservation: jest.fn(),
    createOperationalAudit: jest.fn(),
    createDataChange: jest.fn(),
  };
}

function buildSequelizeMock() {
  return { transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback({})) };
}

describe('FraudService.decideFraudCase', () => {
  it('requires an idempotency key', async () => {
    const repo = buildFraudRepositoryMock();
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    await expect(
      service.decideFraudCase({
        tenantId: '1',
        params: { caseId: '1' },
        body: { decision: 'false_positive', reasonCode: 'ok', applyWatchlist: false },
        currentUser: { sub: '1', role: 'fraud_analyst' },
        idempotencyKey: '',
      }),
    ).rejects.toThrow();
  });

  it('requires reasonCode for confirmed_fraud/blocked decisions', async () => {
    const repo = buildFraudRepositoryMock();
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    await expect(
      service.decideFraudCase({
        tenantId: '1',
        params: { caseId: '1' },
        body: { decision: 'confirmed_fraud', reasonCode: '', applyWatchlist: false },
        currentUser: { sub: '1', role: 'fraud_analyst' },
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws NotFoundException when the fraud case does not exist', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue(null);
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    await expect(
      service.decideFraudCase({
        tenantId: '1',
        params: { caseId: '999' },
        body: { decision: 'false_positive', reasonCode: 'ok', applyWatchlist: false },
        currentUser: { sub: '1', role: 'fraud_analyst' },
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when the case is already closed', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: new Date(), caseStatus: 'closed', customerId: '10', severity: 'high' });
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    await expect(
      service.decideFraudCase({
        tenantId: '1',
        params: { caseId: '1' },
        body: { decision: 'false_positive', reasonCode: 'ok', applyWatchlist: false },
        currentUser: { sub: '1', role: 'fraud_analyst' },
        idempotencyKey: 'idem-3',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates a watchlist entry only when applyWatchlist=true, and closes the case', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'high' });
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    const result = await service.decideFraudCase({
      tenantId: '1',
      params: { caseId: '1' },
      body: { decision: 'confirmed_fraud', reasonCode: 'stolen_identity', applyWatchlist: true },
      currentUser: { sub: '1', role: 'fraud_analyst', internalUserId: '5' },
      idempotencyKey: 'idem-4',
    });

    expect(repo.closeFraudCase).toHaveBeenCalledTimes(1);
    expect(repo.createWatchlistEntry).toHaveBeenCalledTimes(1);
    expect(result.watchlistApplied).toBe(true);
    expect(result.caseStatus).toBe('closed');
  });

  it('sets caseStatus to in_progress (not closed) for needs_more_investigation', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'medium' });
    const service = new FraudService(repo as never, buildSequelizeMock() as never);

    const result = await service.decideFraudCase({
      tenantId: '1',
      params: { caseId: '1' },
      body: { decision: 'needs_more_investigation', reasonCode: 'pending_docs', applyWatchlist: false },
      currentUser: { sub: '1', role: 'fraud_analyst' },
      idempotencyKey: 'idem-5',
    });

    expect(result.caseStatus).toBe('in_progress');
    expect(repo.createWatchlistEntry).not.toHaveBeenCalled();
  });
});
