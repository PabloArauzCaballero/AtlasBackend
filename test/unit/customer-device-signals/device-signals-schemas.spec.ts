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

describe('la ficha mínima de la captura contacts-address-book-2.0.0 (APP-03)', () => {
  const minima = {
    externalId: 'abc-123',
    displayName: 'María Quispe',
    contactType: 'person',
    isFavorite: true,
    phones: [{ number: '+591 76500122' }],
    hasEmail: true,
    hasBirthday: false,
    hasCompany: true,
  };

  it('se acepta tal cual y conserva las banderas; correos y direcciones quedan AUSENTES, no vacíos', () => {
    const r = addressBookSyncSchema.safeParse(
      agenda({ deviceId: '15', algorithmVersion: 'contacts-address-book-2.0.0', contacts: [minima] }),
    );
    expect(r.success).toBe(true);
    const ficha = r.success ? r.data.contacts[0] : undefined;
    expect(ficha).toMatchObject({ hasEmail: true, hasBirthday: false, hasCompany: true });
    expect(ficha?.emails).toBeUndefined();
    expect(ficha?.addresses).toBeUndefined();
    expect(ficha?.birthday).toBeUndefined();
  });

  it('sin banderas también se acepta (compatibilidad 1.x y 2.0.0 sin banderas)', () => {
    const { hasEmail: _e, hasBirthday: _b, hasCompany: _c, ...sinBanderas } = minima;
    expect(addressBookSyncSchema.safeParse(agenda({ deviceId: '15', contacts: [sinBanderas] })).success).toBe(true);
  });

  it('las banderas son booleanos de verdad: "true" o 1 no pasan', () => {
    for (const malo of ['true', 1, null]) {
      expect(addressBookSyncSchema.safeParse(agenda({ deviceId: '15', contacts: [{ ...minima, hasEmail: malo }] })).success).toBe(false);
    }
  });
});
