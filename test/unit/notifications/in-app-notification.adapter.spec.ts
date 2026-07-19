import { describe, expect, it } from '@jest/globals';
import { InAppNotificationAdapter } from '../../../src/modules/notifications/adapters/in-app-notification.adapter.js';

/** `InAppNotificationAdapter`: canal in-app que siempre entrega (se guarda en Atlas). */
describe('InAppNotificationAdapter', () => {
  const adapter = new InAppNotificationAdapter();

  it('getProviderName / supports / validatePayload', () => {
    expect(adapter.getProviderName()).toBe('atlas_in_app');
    expect(adapter.supports('in_app')).toBe(true);
    expect(adapter.supports('email' as never)).toBe(false);
    expect(adapter.validatePayload({ channel: 'in_app', recipientId: 'r', body: 'b' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'in_app', recipientId: '', body: 'b' } as never)).toBe(false);
    expect(adapter.validatePayload({ channel: 'in_app', recipientId: 'r', body: '' } as never)).toBe(false);
  });

  it('send entrega y compone el providerMessageId', async () => {
    const res = await adapter.send({ id: '1', channel: 'in_app', body: 'b' } as never);
    expect(res).toMatchObject({ status: 'delivered', provider: 'atlas_in_app', providerMessageId: 'in_app-1', errorCode: null });
  });
});
