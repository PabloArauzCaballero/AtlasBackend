import { describe, expect, it, jest } from '@jest/globals';
import { SessionGpsWriterService } from '../../../src/modules/sessions/application/session-gps-writer.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5): la
 * distinción entre `gps_not_provided` y `location_permission_not_granted` como
 * `gpsObservationSkippedReason` es la que le permite a Riesgo/Auditoría diferenciar "el cliente
 * nunca mandó GPS" de "el cliente mandó GPS pero no dio permiso" — dos señales de riesgo muy
 * distintas que colapsarían en un solo "no hay GPS" sin este test fijándolas por separado.
 */
describe('SessionGpsWriterService.createSessionGpsIfAllowed', () => {
  function buildService() {
    const sessionsRepository = { findCurrentAddressContext: jest.fn(), createGpsObservation: jest.fn() };
    const service = new SessionGpsWriterService(sessionsRepository as never);
    return { service, sessionsRepository };
  }

  const baseInput = { tenantId: 't1', customerId: 'c1', sessionId: 's1', canStoreGps: true, defaultCapturedAt: new Date('2026-01-01') };

  it('returns gps_not_provided (and does not touch the repository) when no gpsObservation is given', async () => {
    const { service, sessionsRepository } = buildService();
    const result = await service.createSessionGpsIfAllowed({ ...baseInput, gpsObservation: undefined, transaction: {} as never });
    expect(result).toEqual({ gpsObservationId: null, gpsObservationCreated: false, gpsObservationSkippedReason: 'gps_not_provided' });
    expect(sessionsRepository.findCurrentAddressContext).not.toHaveBeenCalled();
  });

  it('returns location_permission_not_granted when gpsObservation IS given but canStoreGps is false — distinguishes from gps_not_provided', async () => {
    const { service, sessionsRepository } = buildService();
    const result = await service.createSessionGpsIfAllowed({
      ...baseInput,
      canStoreGps: false,
      gpsObservation: { lat: -17.78, lng: -63.18 },
      transaction: {} as never,
    });
    expect(result.gpsObservationSkippedReason).toBe('location_permission_not_granted');
    expect(sessionsRepository.createGpsObservation).not.toHaveBeenCalled();
  });

  it("creates the observation and links it to the customer's current declared address context", async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findCurrentAddressContext as jest.Mock).mockResolvedValueOnce({
      addressId: 'addr-1',
      addressVersionId: 'ver-1',
    } as never);
    (sessionsRepository.createGpsObservation as jest.Mock).mockResolvedValueOnce({ id: 'gps-1' } as never);

    const result = await service.createSessionGpsIfAllowed({
      ...baseInput,
      gpsObservation: { lat: -17.78, lng: -63.18, accuracyMeters: 10 },
      transaction: {} as never,
    });

    expect(result).toEqual({ gpsObservationId: 'gps-1', gpsObservationCreated: true, gpsObservationSkippedReason: null });
    const createArgs = (sessionsRepository.createGpsObservation as jest.Mock).mock.calls[0][0] as {
      customerAddressId: string;
      addressVersionId: string;
    };
    expect(createArgs).toMatchObject({ customerAddressId: 'addr-1', addressVersionId: 'ver-1' });
  });

  it('rounds lat/lng to 7 decimal places and accuracy to 2', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findCurrentAddressContext as jest.Mock).mockResolvedValueOnce({ addressId: null, addressVersionId: null } as never);
    (sessionsRepository.createGpsObservation as jest.Mock).mockResolvedValueOnce({ id: 'gps-1' } as never);

    await service.createSessionGpsIfAllowed({
      ...baseInput,
      gpsObservation: { lat: -17.783333333, lng: -63.182222222, accuracyMeters: 12.3456 },
      transaction: {} as never,
    });

    const createArgs = (sessionsRepository.createGpsObservation as jest.Mock).mock.calls[0][0] as {
      gpsLat: string;
      gpsLng: string;
      gpsAccuracyMeters: string;
    };
    expect(createArgs.gpsLat).toBe('-17.7833333');
    expect(createArgs.gpsLng).toBe('-63.1822222');
    expect(createArgs.gpsAccuracyMeters).toBe('12.35');
  });

  it("uses the observation's own capturedAt when provided, instead of defaultCapturedAt", async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findCurrentAddressContext as jest.Mock).mockResolvedValueOnce({ addressId: null, addressVersionId: null } as never);
    (sessionsRepository.createGpsObservation as jest.Mock).mockResolvedValueOnce({ id: 'gps-1' } as never);

    await service.createSessionGpsIfAllowed({
      ...baseInput,
      gpsObservation: { lat: 1, lng: 1, capturedAt: '2026-05-05T00:00:00.000Z' },
      transaction: {} as never,
    });

    const createArgs = (sessionsRepository.createGpsObservation as jest.Mock).mock.calls[0][0] as { capturedAt: Date };
    expect(createArgs.capturedAt.toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });
});
