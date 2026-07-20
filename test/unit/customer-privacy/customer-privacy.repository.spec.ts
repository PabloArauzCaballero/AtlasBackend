import { describe, expect, it, jest } from '@jest/globals';
import { CustomerPrivacyRepository } from '../../../src/modules/customer-privacy/customer-privacy.repository.js';

/**
 * Cobertura directa de `CustomerPrivacyRepository` (Fase 1.2 del plan 10/10): altas de consentimiento,
 * eventos, estado, action log, solicitud de derechos del titular (DSR) y auditoría, con las ramas
 * granted→grantedAt / revoked→revokedAt. Modelos Sequelize mockeados.
 */
describe('CustomerPrivacyRepository', () => {
  function buildRepo() {
    const make = () => ({ create: jest.fn() });
    const models = {
      customerConsent: make(),
      consentEvent: make(),
      customerStatusEvent: make(),
      customerActionLog: make(),
      dataSubjectRequest: make(),
      operationalAuditLog: make(),
    };
    const repo = new CustomerPrivacyRepository(
      models.customerConsent as never,
      models.consentEvent as never,
      models.customerStatusEvent as never,
      models.customerActionLog as never,
      models.dataSubjectRequest as never,
      models.operationalAuditLog as never,
    );
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };
  const now = new Date('2026-01-20');

  it('createCustomerConsent con granted=true/revoked=false fija grantedAt y revokedAt null', async () => {
    const { repo, models } = buildRepo();
    (models.customerConsent.create as jest.Mock).mockResolvedValue({ id: 'cc1' } as never);
    await repo.createCustomerConsent(
      {
        tenantId: 't1',
        customerId: 'c1',
        consentDocumentId: 'd1',
        purposeCode: 'kyc',
        granted: true,
        revoked: false,
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        happenedAt: now,
      },
      opts,
    );
    expect((models.customerConsent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ grantedAt: now, revokedAt: null });
  });

  it('createCustomerConsent con revoked=true fija revokedAt', async () => {
    const { repo, models } = buildRepo();
    (models.customerConsent.create as jest.Mock).mockResolvedValue({ id: 'cc1' } as never);
    await repo.createCustomerConsent(
      {
        tenantId: 't1',
        customerId: 'c1',
        consentDocumentId: 'd1',
        purposeCode: 'kyc',
        granted: false,
        revoked: true,
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        happenedAt: now,
      },
      opts,
    );
    expect((models.customerConsent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ grantedAt: null, revokedAt: now });
  });

  it('createConsentEvent mapea actorType→triggeredByType y happenedAt→createdAtValue', async () => {
    const { repo, models } = buildRepo();
    (models.consentEvent.create as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
    await repo.createConsentEvent(
      {
        tenantId: 't1',
        customerConsentId: 'cc1',
        eventType: 'revoked',
        channel: 'app',
        sessionId: null,
        ipAddress: null,
        actorType: 'internal',
        actorInternalUserId: 'u1',
        notes: null,
        happenedAt: now,
      },
      opts,
    );
    expect((models.consentEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      triggeredByType: 'internal',
      triggeredByInternalUserId: 'u1',
      createdAtValue: now,
    });
  });

  it('createStatusEvent mapea actor→changedBy* y conserva previousStatus', async () => {
    const { repo, models } = buildRepo();
    (models.customerStatusEvent.create as jest.Mock).mockResolvedValue({ id: 's1' } as never);
    await repo.createStatusEvent(
      {
        tenantId: 't1',
        customerId: 'c1',
        previousStatus: 'active',
        newStatus: 'suspended',
        reasonCode: 'risk',
        actorType: 'internal',
        actorInternalUserId: 'u1',
        actorPlatformUserId: null,
        happenedAt: now,
        notes: null,
      },
      opts,
    );
    expect((models.customerStatusEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      previousStatus: 'active',
      newStatus: 'suspended',
      changedByType: 'internal',
      changedByInternalUserId: 'u1',
    });
  });

  it('createActionLog fija screenName=privacy y deviceId null', async () => {
    const { repo, models } = buildRepo();
    (models.customerActionLog.create as jest.Mock).mockResolvedValue({ id: 'al1' } as never);
    await repo.createActionLog(
      { tenantId: 't1', customerId: 'c1', sessionId: null, eventName: 'export', payload: { a: 1 }, occurredAt: now },
      opts,
    );
    expect((models.customerActionLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      screenName: 'privacy',
      deviceId: null,
      actionPayloadJson: { a: 1 },
    });
  });

  it('createDataSubjectRequest nace received, no resuelto y no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.dataSubjectRequest.create as jest.Mock).mockResolvedValue({ id: 'dsr1' } as never);
    const dueAt = new Date('2026-02-20');
    await repo.createDataSubjectRequest(
      { tenantId: 't1', requestCode: 'REQ-1', customerId: 'c1', requestType: 'access', dueAt, requestedAt: now },
      opts,
    );
    expect((models.dataSubjectRequest.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      status: 'received',
      resolvedAt: null,
      handledBy: null,
      deleted: false,
      dueAt,
    });
  });

  it('createAudit fija userAgent null y createdAtValue=occurredAt', async () => {
    const { repo, models } = buildRepo();
    (models.operationalAuditLog.create as jest.Mock).mockResolvedValue({ id: 'a1' } as never);
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'internal',
        actorInternalUserId: 'u1',
        actorPlatformUserId: null,
        actionCode: 'privacy.export',
        targetType: 'customer',
        targetId: 'c1',
        ipAddress: null,
        payload: {},
        occurredAt: now,
      },
      opts,
    );
    expect((models.operationalAuditLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({ userAgent: null, createdAtValue: now });
  });
});
