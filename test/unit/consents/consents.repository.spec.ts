import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { ConsentsRepository } from '../../../src/modules/consents/consents.repository.js';

/**
 * Cobertura directa de `ConsentsRepository` (Fase 1.2 del plan 10/10): documentos de consentimiento
 * vigentes (ventana effectiveFrom/effectiveUntil), y alta de decisión + evento del cliente con la
 * rama granted → grantedAt / revokedAt. Servicio y controller lo mockean. Modelos Sequelize mockeados.
 */
describe('ConsentsRepository', () => {
  function buildRepo() {
    const consentDocumentModel = { findAll: asyncMock(), findOne: asyncMock() };
    const customerConsentModel = { create: asyncMock() };
    const consentEventModel = { create: asyncMock() };
    const repo = new ConsentsRepository(consentDocumentModel as never, customerConsentModel as never, consentEventModel as never);
    return { repo, consentDocumentModel, customerConsentModel, consentEventModel };
  }

  const opts = { transaction: 'tx' as never };

  it('findActiveDocuments filtra published + idioma, sin documentCode cuando no hay purposeCode', async () => {
    const { repo, consentDocumentModel } = buildRepo();
    (consentDocumentModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findActiveDocuments('t1', { language: 'es' });
    const where = callArg<CallArgRecord>(consentDocumentModel.findAll, 0, 0).where as Record<string, unknown>;
    expect(where).toMatchObject({ tenantId: 't1', language: 'es', status: 'published' });
    expect(where.documentCode).toBeUndefined();
    expect(where[Op.and as unknown as string]).toBeDefined();
  });

  it('findActiveDocuments añade documentCode cuando hay purposeCode', async () => {
    const { repo, consentDocumentModel } = buildRepo();
    (consentDocumentModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findActiveDocuments('t1', { language: 'es', purposeCode: 'kyc' });
    const where = callArg<CallArgRecord>(consentDocumentModel.findAll, 0, 0).where as Record<string, unknown>;
    expect(where.documentCode).toBe('kyc');
  });

  it('findActiveDocumentById busca por id+tenant y estado published', async () => {
    const { repo, consentDocumentModel } = buildRepo();
    (consentDocumentModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findActiveDocumentById('t1', 'd1');
    expect(callArg<CallArgRecord>(consentDocumentModel.findOne, 0, 0).where).toMatchObject({
      id: 'd1',
      tenantId: 't1',
      status: 'published',
    });
  });

  it('findActiveDocumentsByIds corta en seco (sin query) para lista vacía', async () => {
    const { repo, consentDocumentModel } = buildRepo();
    const result = await repo.findActiveDocumentsByIds('t1', []);
    expect(result).toEqual([]);
    expect(consentDocumentModel.findAll).not.toHaveBeenCalled();
  });

  it('findActiveDocumentsByIds usa Op.in con los ids', async () => {
    const { repo, consentDocumentModel } = buildRepo();
    (consentDocumentModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findActiveDocumentsByIds('t1', ['d1', 'd2']);
    const where = callArg<CallArgRecord>(consentDocumentModel.findAll, 0, 0).where as { id: Record<symbol, unknown> };
    expect(where.id[Op.in]).toEqual(['d1', 'd2']);
  });

  it('createCustomerConsent con granted=true fija grantedAt y deja revokedAt null', async () => {
    const { repo, customerConsentModel } = buildRepo();
    (customerConsentModel.create as jest.Mock).mockResolvedValue({ id: 'cc1' } as never);
    const happenedAt = new Date('2026-01-14');
    await repo.createCustomerConsent(
      {
        tenantId: 't1',
        customerId: 'c1',
        consentDocumentId: 'd1',
        purposeCode: 'kyc',
        granted: true,
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        deviceFingerprintSnapshot: null,
        userAgent: null,
        evidenceSnapshotUrl: null,
        happenedAt,
      },
      opts,
    );
    expect((customerConsentModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ grantedAt: happenedAt, revokedAt: null });
  });

  it('createCustomerConsent con granted=false fija revokedAt y deja grantedAt null', async () => {
    const { repo, customerConsentModel } = buildRepo();
    (customerConsentModel.create as jest.Mock).mockResolvedValue({ id: 'cc1' } as never);
    const happenedAt = new Date('2026-01-15');
    await repo.createCustomerConsent(
      {
        tenantId: 't1',
        customerId: 'c1',
        consentDocumentId: 'd1',
        purposeCode: 'kyc',
        granted: false,
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        deviceFingerprintSnapshot: null,
        userAgent: null,
        evidenceSnapshotUrl: null,
        happenedAt,
      },
      opts,
    );
    expect((customerConsentModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ grantedAt: null, revokedAt: happenedAt });
  });

  it('createConsentEvent mapea happenedAt a createdAtValue', async () => {
    const { repo, consentEventModel } = buildRepo();
    (consentEventModel.create as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
    const happenedAt = new Date('2026-01-16');
    await repo.createConsentEvent(
      {
        tenantId: 't1',
        customerConsentId: 'cc1',
        eventType: 'granted',
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        deviceFingerprintSnapshot: null,
        triggeredByType: 'customer',
        triggeredByInternalUserId: null,
        notes: null,
        happenedAt,
      },
      opts,
    );
    expect((consentEventModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ happenedAt, createdAtValue: happenedAt });
  });
});
