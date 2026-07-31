import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SessionsLocationRepository } from '../../../src/modules/sessions/repositories/sessions-location.repository.js';

/**
 * Cobertura directa de `SessionsLocationRepository` (Fase 1.2 del plan 10/10): dirección declarada y
 * observaciones GPS de la sesión. Sub-repo con lógica real de ramas (dirección sin versión actual →
 * segunda consulta de versión vigente). Modelos Sequelize mockeados.
 */
describe('SessionsLocationRepository', () => {
  function buildRepo() {
    const customerAddressModel = { findOne: asyncMock() };
    const customerAddressVersionModel = { findOne: asyncMock() };
    const addressGpsObservationModel = { create: asyncMock(), findOne: asyncMock(), findAll: asyncMock() };
    const repo = new SessionsLocationRepository(
      customerAddressModel as never,
      customerAddressVersionModel as never,
      addressGpsObservationModel as never,
    );
    return { repo, customerAddressModel, customerAddressVersionModel, addressGpsObservationModel };
  }

  const opts = { transaction: 'tx' as never };

  it('findCurrentAddressContext devuelve nulls cuando no hay dirección', async () => {
    const { repo, customerAddressModel } = buildRepo();
    (customerAddressModel.findOne as jest.Mock).mockResolvedValue(null as never);
    const result = await repo.findCurrentAddressContext('t1', 'c1', opts);
    expect(result).toEqual({ addressId: null, addressVersionId: null });
  });

  it('findCurrentAddressContext usa currentVersionId sin segunda consulta', async () => {
    const { repo, customerAddressModel, customerAddressVersionModel } = buildRepo();
    (customerAddressModel.findOne as jest.Mock).mockResolvedValue({ id: 7, currentVersionId: 99 } as never);
    const result = await repo.findCurrentAddressContext('t1', 'c1');
    expect(result).toEqual({ addressId: '7', addressVersionId: '99' });
    expect(customerAddressVersionModel.findOne).not.toHaveBeenCalled();
  });

  it('findCurrentAddressContext busca la versión vigente cuando no hay currentVersionId', async () => {
    const { repo, customerAddressModel, customerAddressVersionModel } = buildRepo();
    (customerAddressModel.findOne as jest.Mock).mockResolvedValue({ id: 7, currentVersionId: null } as never);
    (customerAddressVersionModel.findOne as jest.Mock).mockResolvedValue({ id: 42 } as never);
    const result = await repo.findCurrentAddressContext('t1', 'c1', opts);
    expect(callArg<CallArgRecord>(customerAddressVersionModel.findOne, 0, 0).where).toMatchObject({
      tenantId: 't1',
      customerAddressId: '7',
      validUntil: null,
    });
    expect(result).toEqual({ addressId: '7', addressVersionId: '42' });
  });

  it('findCurrentAddressContext devuelve addressVersionId null si no hay versión vigente', async () => {
    const { repo, customerAddressModel, customerAddressVersionModel } = buildRepo();
    (customerAddressModel.findOne as jest.Mock).mockResolvedValue({ id: 7, currentVersionId: null } as never);
    (customerAddressVersionModel.findOne as jest.Mock).mockResolvedValue(null as never);
    const result = await repo.findCurrentAddressContext('t1', 'c1');
    expect(result).toEqual({ addressId: '7', addressVersionId: null });
  });

  it('createGpsObservation nace con score/distancia nulos y capturedAt como createdAtValue', async () => {
    const { repo, addressGpsObservationModel } = buildRepo();
    (addressGpsObservationModel.create as jest.Mock).mockResolvedValue({ id: 'o1' } as never);
    const capturedAt = new Date('2026-03-03');
    await repo.createGpsObservation(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        customerAddressId: 'a1',
        addressVersionId: 'v1',
        gpsLat: '1',
        gpsLng: '2',
        gpsAccuracyMeters: '5',
        capturedAt,
      },
      opts,
    );
    expect((addressGpsObservationModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      matchScoreAgainstDeclaredAddress: null,
      distanceToDeclaredMeters: null,
      capturedAt,
      createdAtValue: capturedAt,
    });
  });

  it('findLatestGpsObservation ordena por capturedAt desc', async () => {
    const { repo, addressGpsObservationModel } = buildRepo();
    (addressGpsObservationModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestGpsObservation('t1', 's1');
    expect(callArg<CallArgRecord>(addressGpsObservationModel.findOne, 0, 0).order).toEqual([
      ['capturedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('findSessionGpsObservations aplica el límite por defecto de 30', async () => {
    const { repo, addressGpsObservationModel } = buildRepo();
    (addressGpsObservationModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionGpsObservations('t1', 's1');
    expect(callArg<CallArgRecord>(addressGpsObservationModel.findAll, 0, 0).limit).toBe(30);
  });
});
