import {
  addressBookSyncSchema,
  locationPingBatchSchema,
} from '../../../src/modules/customer-device-signals/customer-device-signals.schemas';

const agenda = (extra: Record<string, unknown>) => ({
  algorithmVersion: 'v1',
  capturedAt: '2026-10-05T10:00:00.000Z',
  totalContactsInDevice: 1,
  contacts: [{ externalId: 'a' }],
  ...extra,
});

describe('identificadores de dispositivo y sesión', () => {
  it('uno numérico se acepta y uno no numérico es 400 (antes llegaba a un BIGINT y daba 500)', () => {
    expect(addressBookSyncSchema.safeParse(agenda({ deviceId: '15', sessionId: '8' })).success).toBe(true);
    expect(addressBookSyncSchema.safeParse(agenda({ deviceId: 'dev-1' })).success).toBe(false);
    expect(addressBookSyncSchema.safeParse(agenda({ deviceId: '15', sessionId: 'abc' })).success).toBe(false);
    expect(addressBookSyncSchema.safeParse(agenda({ deviceId: '15', sessionId: null })).success).toBe(true);
  });

  it('el lote de ubicación aplica la misma regla', () => {
    const lote = (deviceId: string) => ({
      deviceId,
      pings: [{ lat: 1, lng: 1, capturedAt: '2026-10-05T10:00:00.000Z' }],
    });
    expect(locationPingBatchSchema.safeParse(lote('dev-1')).success).toBe(false);
    expect(locationPingBatchSchema.safeParse(lote('15')).success).toBe(true);
  });
});
