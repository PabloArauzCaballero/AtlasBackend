import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FraudService } from '../../../src/modules/fraud/fraud.service.js';

/**
 * Regresión para confirmar que `FraudService.decideFraudCase` conserva el comportamiento
 * observable de la ruta operativa compatible.
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

function buildCustomersRepositoryMock(overrides: Record<string, unknown> = {}) {
  return {
    findById: jest.fn(async () => ({ id: '10', primaryPhoneHash: 'hash-of-real-phone', primaryPhoneLast4: '6789', primaryEmailHash: null })),
    ...overrides,
  };
}

function buildSequelizeMock() {
  return { transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback({})) };
}

describe('FraudService.decideFraudCase', () => {
  it('requires an idempotency key', async () => {
    const repo = buildFraudRepositoryMock();
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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

  it('watchlists by the customer\'s real phone/email hash, never by the internal customerId (regression)', async () => {
    // Antes de este fix, el watchlist se creaba con `entityHash = hash(customerId)` — un valor
    // que NUNCA puede volver a coincidir porque un futuro registro fraudulento del mismo actor
    // recibe un customerId distinto. Debe usar los hashes reales de contacto del cliente.
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'high' });
    const customersRepository = buildCustomersRepositoryMock({
      findById: jest.fn(async () => ({
        id: '10',
        primaryPhoneHash: 'hash-of-real-phone',
        primaryPhoneLast4: '6789',
        primaryEmailHash: 'hash-of-real-email',
      })),
    });
    const service = new FraudService(repo as never, customersRepository as never, buildSequelizeMock() as never);

    const result = await service.decideFraudCase({
      tenantId: '1',
      params: { caseId: '1' },
      body: { decision: 'confirmed_fraud', reasonCode: 'stolen_identity', applyWatchlist: true },
      currentUser: { sub: '1', role: 'fraud_analyst', internalUserId: '5' },
      idempotencyKey: 'idem-6',
    });

    expect(customersRepository.findById).toHaveBeenCalledWith('1', '10');
    // Dos identificadores (teléfono + email) → dos entradas de watchlist independientes.
    expect(repo.createWatchlistEntry).toHaveBeenCalledTimes(2);
    const calls = (repo.createWatchlistEntry as jest.Mock).mock.calls as Array<
      [{ entityType: string; entityHash: string | null; entityLast4: string | null }]
    >;
    const byType = Object.fromEntries(calls.map(([args]) => [args.entityType, args]));
    expect(byType.phone).toMatchObject({ entityHash: 'hash-of-real-phone', entityLast4: '6789' });
    expect(byType.email).toMatchObject({ entityHash: 'hash-of-real-email', entityLast4: null });
    // Ningún entityHash generado a partir del customerId ('10').
    expect(calls.every(([args]) => args.entityHash !== '10')).toBe(true);
    expect(result.watchlistApplied).toBe(true);
  });

  it('does not apply a watchlist entry when the customer has no phone/email hash on record', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'high' });
    const customersRepository = buildCustomersRepositoryMock({
      findById: jest.fn(async () => ({ id: '10', primaryPhoneHash: null, primaryEmailHash: null })),
    });
    const service = new FraudService(repo as never, customersRepository as never, buildSequelizeMock() as never);

    const result = await service.decideFraudCase({
      tenantId: '1',
      params: { caseId: '1' },
      body: { decision: 'confirmed_fraud', reasonCode: 'stolen_identity', applyWatchlist: true },
      currentUser: { sub: '1', role: 'fraud_analyst', internalUserId: '5' },
      idempotencyKey: 'idem-7',
    });

    expect(repo.createWatchlistEntry).not.toHaveBeenCalled();
    expect(result.watchlistApplied).toBe(false);
  });

  it('does not require reasonCode for false_positive (regression: fraudDecisionSchema used to force it for every decision)', async () => {
    // Antes de este fix, `fraudDecisionSchema.reasonCode` era obligatorio para TODA decisión —
    // incluyendo `false_positive` — así que este chequeo de servicio (que solo lo exige para
    // confirmed_fraud/blocked) nunca se alcanzaba vía HTTP. Ahora el schema lo hace opcional y
    // el service usa la decisión misma como motivo de respaldo en los logs de auditoría.
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'low' });
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

    const result = await service.decideFraudCase({
      tenantId: '1',
      params: { caseId: '1' },
      body: { decision: 'false_positive', applyWatchlist: false },
      currentUser: { sub: '1', role: 'fraud_analyst' },
      idempotencyKey: 'idem-8',
    });

    expect(result.caseStatus).toBe('closed');
    expect(repo.createDataChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'false_positive' }), expect.anything());
  });

  it('sets caseStatus to in_progress (not closed) for needs_more_investigation', async () => {
    const repo = buildFraudRepositoryMock();
    repo.findFraudCaseById.mockResolvedValue({ id: '1', closedAt: null, caseStatus: 'open', customerId: '10', severity: 'medium' });
    const service = new FraudService(repo as never, buildCustomersRepositoryMock() as never, buildSequelizeMock() as never);

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
