import { describe, expect, it, jest } from '@jest/globals';
import { NotificationsController } from '../../../src/modules/notifications/notifications.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `NotificationsController` (19 endpoints) delega todo en `NotificationsService`. Spec representativo:
 * operaciones (tenant 1-arg + idempotency), autoservicio de cliente y de usuario interno (tenant 2-arg
 * con fallback al token). Con el servicio mockeado.
 */
describe('NotificationsController', () => {
  function build() {
    const service = {
      listMessages: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      retryMessage: jest.fn(async (..._args: unknown[]) => ({ retried: true })),
      broadcast: jest.fn(async (..._args: unknown[]) => ({ created: 3 })),
      listCustomerNotifications: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      listMyNotifications: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    };
    return { controller: new NotificationsController(service as never), service };
  }
  const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const internal = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;

  it('listMessages (operaciones) delega con el tenant del header', async () => {
    const { controller, service } = build();
    await controller.listMessages('1', { status: 'PENDING' } as never);
    expect(service.listMessages).toHaveBeenCalledWith(tenantIdFromHeader('1'), { status: 'PENDING' });
  });

  it('retryMessage y broadcast exigen x-idempotency-key', async () => {
    const { controller, service } = build();
    await controller.retryMessage('1', 'idem', { messageId: 'm1' } as never);
    expect(service.retryMessage).toHaveBeenCalledWith(tenantIdFromHeader('1'), 'm1');
    expect(() => controller.retryMessage('1', undefined, { messageId: 'm1' } as never)).toThrow();

    await controller.broadcastNotification('1', 'idem', { title: 'hi' } as never);
    expect(service.broadcast).toHaveBeenCalledWith(tenantIdFromHeader('1'), { title: 'hi' });
    expect(() => controller.broadcastNotification('1', undefined, {} as never)).toThrow();
  });

  it('el autoservicio de cliente usa el tenant con fallback al token', async () => {
    const { controller, service } = build();
    await controller.listCustomerNotifications('1', { customerId: '9' } as never, { status: 'unread' } as never, customer);
    expect(service.listCustomerNotifications).toHaveBeenCalledWith(tenantIdFromHeader('1', customer), '9', { status: 'unread' }, customer);
  });

  it('el autoservicio interno ("me") saca el destinatario del token', async () => {
    const { controller, service } = build();
    await controller.listMyNotifications('1', { status: 'unread' } as never, internal);
    expect(service.listMyNotifications).toHaveBeenCalledWith(tenantIdFromHeader('1', internal), { status: 'unread' }, internal);
  });
});
