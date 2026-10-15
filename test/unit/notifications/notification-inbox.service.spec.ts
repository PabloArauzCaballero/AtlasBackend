import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { NotificationInboxService } from '../../../src/modules/notifications/notification-inbox.service.js';

/** Guardas de autorización propias (assertCustomerAccess / requireInternalUserId) y delegación a la bandeja. */
describe('NotificationInboxService', () => {
  function build() {
    const inbox = {
      listRecipientMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      countUnreadMessages: jest.fn(async (..._args: unknown[]) => 3),
      getRecipientMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1 })),
      markRead: jest.fn(async (..._args: unknown[]) => ({ id: 1, status: 'read' })),
      markAllRecipientRead: jest.fn(async (..._args: unknown[]) => 6),
    };
    return { service: new NotificationInboxService(inbox as never), inbox };
  }
  const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const internal = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;
  const noInternalId = { role: 'internal_operator', tenantId: '1' } as never;
  const q = { page: 1, limit: 10 } as never;

  it('assertCustomerAccess: el customer solo accede a lo suyo; los internos a todo', async () => {
    const { service, inbox } = build();
    await expect(service.listCustomerNotifications('1', '9', q, customer)).resolves.toBeDefined();
    expect(inbox.listRecipientMessages).toHaveBeenCalledWith('1', 'customer', '9', q);
    await expect(service.listCustomerNotifications('1', '99', q, customer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.unreadCount('1', '55', internal)).resolves.toEqual({ unread: 3 });
  });

  it('marcar leído (uno o todos) delega cuando el acceso es válido', async () => {
    const { service, inbox } = build();
    await service.markCustomerNotificationRead('1', '9', 'n1', customer);
    expect(inbox.getRecipientMessage).toHaveBeenCalledWith('1', 'customer', '9', 'n1', 'CUSTOMER_NOTIFICATION_NOT_FOUND');
    expect(await service.markAllCustomerNotificationsRead('1', '9', customer)).toEqual({ updated: 6 });
    expect(inbox.markRead).toHaveBeenCalledTimes(1);
  });

  it('el autoservicio interno exige internalUserId (Forbidden si falta)', async () => {
    const { service, inbox } = build();
    await service.listMyNotifications('1', q, internal);
    expect(inbox.listRecipientMessages).toHaveBeenCalledWith('1', 'internal_user', 'u1', q);
    await expect(service.listMyNotifications('1', q, noInternalId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.myUnreadCount('1', noInternalId)).rejects.toBeInstanceOf(ForbiddenException);
    await service.markMyNotificationRead('1', 'n2', internal);
    expect(inbox.getRecipientMessage).toHaveBeenCalledWith('1', 'internal_user', 'u1', 'n2', 'NOTIFICATION_NOT_FOUND');
    expect(await service.markAllMyNotificationsRead('1', internal)).toEqual({ updated: 6 });
  });
});
