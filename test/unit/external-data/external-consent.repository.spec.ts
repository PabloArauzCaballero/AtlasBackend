import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { ExternalConsentRepository } from '../../../src/modules/external-data/infrastructure/external-consent.repository.js';

/**
 * Cobertura directa de `ExternalConsentRepository`: consentimientos del cliente. Modelos Sequelize mockeados.
 */
describe('ExternalConsentRepository', () => {
  function buildRepo() {
    const make = () => ({
      findOne: asyncMock(),
      findAll: asyncMock(),
      findByPk: asyncMock(),
      create: asyncMock(),
      update: asyncMock(),
      count: asyncMock(),
      bulkCreate: asyncMock(),
    });
    const models = {
      customerConsent: make(),
    };
    const repo = new ExternalConsentRepository(models.customerConsent as never);
    return { repo, models };
  }

  it('revokeCustomerConsent devuelve null si no existe; si existe marca granted=false y revokedAt', async () => {
    const missing = buildRepo();
    (missing.models.customerConsent.findOne as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.revokeCustomerConsent('t1', 'c1', new Date())).toBeNull();

    const found = buildRepo();
    const consent = { update: jest.fn(async (..._args: unknown[]) => undefined) };
    (found.models.customerConsent.findOne as jest.Mock).mockResolvedValue(consent as never);
    const now = new Date('2026-01-01');
    await found.repo.revokeCustomerConsent('t1', 'c1', now);
    expect((consent.update as jest.Mock).mock.calls[0][0]).toMatchObject({ granted: false, revokedAt: now });
  });

  it('consentimientos: findCustomerConsent (granted+no-revocado), byId, list y create', async () => {
    const { repo, models } = buildRepo();
    (models.customerConsent.findOne as jest.Mock).mockResolvedValue(null as never);
    (models.customerConsent.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.customerConsent.create as jest.Mock).mockResolvedValue({ id: 'k1' } as never);

    await repo.findCustomerConsent('t1', 'c1', ['KYC_SEGIP']);
    expect((models.customerConsent.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1', granted: true, revokedAt: null },
    });
    await repo.findCustomerConsentByIdAndTenant('t1', 'k9');
    expect((models.customerConsent.findOne as jest.Mock).mock.calls[1][0]).toMatchObject({ where: { tenantId: 't1', id: 'k9' } });
    await repo.listCustomerConsents('t1', 'c1');
    expect((models.customerConsent.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1' },
      limit: 100,
    });
    await repo.createCustomerConsent({ tenantId: 't1', customerId: 'c1', purposeCode: 'KYC_SEGIP', channel: 'web', now: new Date() });
    expect((models.customerConsent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      purposeCode: 'KYC_SEGIP',
      granted: true,
      consentDocumentId: null,
      channel: 'web',
    });
  });
});
