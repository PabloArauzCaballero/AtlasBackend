import { describe, expect, it, jest } from '@jest/globals';
import { RiskCustomerFactsRepository } from '../../../src/modules/risk/repositories/risk-customer-facts.repository.js';

/** Cobertura directa de los accesos de lectura del cliente evaluado: alimentan una decisión de crédito. */
describe('RiskCustomerFactsRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), count: jest.fn() });
    const models = { consent: make(), contactMethod: make(), identityDocument: make(), session: make(), deviceLink: make() };
    const repo = new RiskCustomerFactsRepository(
      models.consent as never,
      models.contactMethod as never,
      models.identityDocument as never,
      models.session as never,
      models.deviceLink as never,
    );
    return { repo, models };
  }

  it('findOwnedDeviceReferences: el dispositivo es del cliente por vínculo o por sesión; la sesión, si es suya', async () => {
    const { repo, models } = buildRepo();
    const contar = (m: unknown, n: number) => ((m as { count: jest.Mock }).count = jest.fn(async () => n));
    contar(models.deviceLink, 0);
    contar(models.session, 0);
    await expect(repo.findOwnedDeviceReferences('t1', '5', { deviceId: '9', sessionId: '3' })).resolves.toEqual({
      deviceOwned: false,
      sessionOwned: false,
    });
    contar(models.deviceLink, 1);
    await expect(repo.findOwnedDeviceReferences('t1', '5', { deviceId: '9' })).resolves.toEqual({ deviceOwned: true, sessionOwned: true });
    expect((models.deviceLink as unknown as { count: jest.Mock }).count).toHaveBeenCalledWith({
      where: { tenantId: 't1', customerId: '5', deviceId: '9' },
    });
  });

  it('findCustomerConsents devuelve SOLO los consentimientos otorgados (granted: true)', async () => {
    const { repo, models } = buildRepo();
    (models.consent.findAll as jest.Mock).mockResolvedValue([] as never);

    await repo.findCustomerConsents('t1', 'c1');

    // Regla de negocio: un consentimiento revocado no debe alimentar una decisión de riesgo.
    const options = (models.consent.findAll as jest.Mock).mock.calls[0][0] as { where: unknown };
    expect(options.where).toEqual({ tenantId: 't1', customerId: 'c1', granted: true });
  });

  it('findCustomerContacts y findIdentityDocuments filtran por tenant + cliente', async () => {
    const { repo, models } = buildRepo();
    (models.contactMethod.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.identityDocument.findAll as jest.Mock).mockResolvedValue([] as never);

    await repo.findCustomerContacts('t1', 'c1');
    await repo.findIdentityDocuments('t1', 'c1');

    expect((models.contactMethod.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1' },
    });
    expect((models.identityDocument.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1' },
    });
  });
});
