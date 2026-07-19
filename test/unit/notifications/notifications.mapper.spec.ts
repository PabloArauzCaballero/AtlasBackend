import { describe, expect, it } from '@jest/globals';
import {
  mapDelivery,
  mapDeviceToken,
  mapMessage,
  mapPreference,
  mapTemplate,
} from '../../../src/modules/notifications/notifications.mapper.js';

/** Mappers puros de `notifications`: normalizan ids a String y la rama tenantId/outboxEventId null. */
describe('notifications.mapper', () => {
  it('mapMessage normaliza ids y deja null cuando tenantId/outboxEventId son null', () => {
    expect(mapMessage({ id: 1, tenantId: 2, outboxEventId: 3, channel: 'in_app', status: 'sent' } as never)).toMatchObject({
      id: '1',
      tenantId: '2',
      outboxEventId: '3',
    });
    const nulls = mapMessage({ id: 1, tenantId: null, outboxEventId: null, channel: 'in_app', status: 'sent' } as never);
    expect(nulls).toMatchObject({ tenantId: null, outboxEventId: null });
  });

  it('mapTemplate normaliza id/tenantId (null vs set)', () => {
    expect(mapTemplate({ id: 5, tenantId: null, code: 'C', channel: 'email' } as never)).toMatchObject({ id: '5', tenantId: null });
    expect(mapTemplate({ id: 5, tenantId: 9, code: 'C', channel: 'email' } as never).tenantId).toBe('9');
  });

  it('mapDelivery, mapPreference y mapDeviceToken normalizan sus ids', () => {
    expect(mapDelivery({ id: 1, notificationMessageId: 2, channel: 'push', status: 'sent', attemptNumber: 1 } as never)).toMatchObject({ id: '1', notificationMessageId: '2' });
    expect(mapPreference({ id: 3, customerId: 4, eventCode: 'e', channel: 'email', isEnabled: true, isRequired: false } as never)).toMatchObject({ id: '3', customerId: '4' });
    expect(mapDeviceToken({ id: 5, customerId: 6, platform: 'ios', deviceId: 'd', isActive: true } as never)).toMatchObject({ id: '5', customerId: '6' });
  });
});
