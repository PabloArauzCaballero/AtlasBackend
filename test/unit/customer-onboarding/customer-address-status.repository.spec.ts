import { describe, expect, it, jest } from '@jest/globals';
import { CustomerAddressStatusRepository } from '../../../src/modules/customer-onboarding/repositories/customer-address-status.repository.js';

/**
 * Cobertura directa de `CustomerAddressStatusRepository` (Fase 1.2 del plan 10/10): dirección
 * declarada con versionado, observaciones GPS, observaciones genéricas y transición de estado del
 * cliente. Sub-repo con defaults de alta y mutaciones. Modelos Sequelize mockeados.
 */
describe('CustomerAddressStatusRepository', () => {
  function buildRepo() {
    const customerAddressModel = { findOne: jest.fn(), create: jest.fn() };
    const customerAddressVersionModel = { create: jest.fn() };
    const addressGpsObservationModel = { create: jest.fn() };
    const customerObservationModel = { create: jest.fn() };
    const customerModel = {};
    const repo = new CustomerAddressStatusRepository(
      customerAddressModel as never,
      customerAddressVersionModel as never,
      addressGpsObservationModel as never,
      customerObservationModel as never,
      customerModel as never,
    );
    return { repo, customerAddressModel, customerAddressVersionModel, addressGpsObservationModel, customerObservationModel };
  }

  const opts = { transaction: 'tx' as never };
  const now = new Date('2026-01-11');

  it('findCurrentAddress excluye borrados y ordena por lastSeenAt desc', async () => {
    const { repo, customerAddressModel } = buildRepo();
    (customerAddressModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findCurrentAddress('t1', 'c1', 'home', opts);
    const arg = (customerAddressModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toMatchObject({ tenantId: 't1', customerId: 'c1', addressType: 'home' });
    expect(arg.where.deleted).toBeDefined();
    expect(arg.order).toEqual([
      ['lastSeenAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('createAddress nace declared, sin versión actual y no borrado', async () => {
    const { repo, customerAddressModel } = buildRepo();
    (customerAddressModel.create as jest.Mock).mockResolvedValue({ id: 'a1' } as never);
    await repo.createAddress({ tenantId: 't1', customerId: 'c1', addressType: 'home', now }, opts);
    expect((customerAddressModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      status: 'declared',
      currentVersionId: null,
      firstSeenAt: now,
      lastSeenAt: now,
      deleted: false,
    });
  });

  it('touchAddress actualiza lastSeenAt/updatedAtValue y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const address = { save } as never;
    await repo.touchAddress(address, now, opts);
    expect((address as { lastSeenAt: Date; updatedAtValue: Date }).lastSeenAt).toBe(now);
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createAddressVersion nace declared, vigente (validUntil null) y espeja zone en geoZoneNameSnapshot', async () => {
    const { repo, customerAddressVersionModel } = buildRepo();
    (customerAddressVersionModel.create as jest.Mock).mockResolvedValue({ id: 'v1' } as never);
    await repo.createAddressVersion(
      {
        tenantId: 't1',
        customerAddressId: 'a1',
        declaredAddressText: 'calle 1',
        normalizedAddressText: 'calle 1',
        zone: 'centro',
        city: 'LP',
        department: 'LP',
        countryCode: 'BO',
        sourceType: 'api',
        validFrom: now,
      },
      opts,
    );
    expect((customerAddressVersionModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      declaredZoneName: 'centro',
      geoZoneNameSnapshot: 'centro',
      verificationStatus: 'declared',
      validUntil: null,
      createdAtValue: now,
    });
  });

  it('updateAddressCurrentVersion fija currentVersionId y toca timestamps', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const address = { save } as never;
    await repo.updateAddressCurrentVersion(address, 'v9', now, opts);
    expect((address as { currentVersionId: string }).currentVersionId).toBe('v9');
    expect((address as { lastSeenAt: Date }).lastSeenAt).toBe(now);
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createGpsObservation fija score/distancia nulos y createdAtValue=capturedAt', async () => {
    const { repo, addressGpsObservationModel } = buildRepo();
    (addressGpsObservationModel.create as jest.Mock).mockResolvedValue({ id: 'o1' } as never);
    await repo.createGpsObservation(
      { tenantId: 't1', customerId: 'c1', customerAddressId: 'a1', addressVersionId: 'v1', sessionId: 's1', gpsLat: '1', gpsLng: '2', gpsAccuracyMeters: '5', capturedAt: now },
      opts,
    );
    expect((addressGpsObservationModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      matchScoreAgainstDeclaredAddress: null,
      distanceToDeclaredMeters: null,
      createdAtValue: now,
    });
  });

  it('createCustomerObservation nace observed con sourceType api', async () => {
    const { repo, customerObservationModel } = buildRepo();
    (customerObservationModel.create as jest.Mock).mockResolvedValue({ id: 'ob1' } as never);
    await repo.createCustomerObservation(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: null,
        deviceId: null,
        observationCode: 'geo',
        valueText: null,
        valueNumber: null,
        valueBoolean: true,
        valueJson: null,
        confidenceScore: null,
        observedAt: now,
      },
      opts,
    );
    expect((customerObservationModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      sourceType: 'api',
      verificationStatus: 'observed',
      capturedAt: now,
      validFrom: now,
      validUntil: null,
    });
  });

  it('updateCustomerStatus fija lifecycleStatus y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const customer = { save } as never;
    await repo.updateCustomerStatus(customer, 'active', now, opts);
    expect((customer as { lifecycleStatus: string }).lifecycleStatus).toBe('active');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });
});
