import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';

/**
 * `NotificationsService`: guardas de autorización propias (assertCustomerAccess / requireInternalUserId),
 * paginación (totalPages) y mapeo, más delegación a orchestrator/broadcast. Spec directo con repo y
 * colaboradores mockeados; los mappers corren de verdad.
 */
describe('NotificationsService', () => {
  function build() {
    const repository = {
      listMessages: jest.fn(async () => ({ rows: [], count: 0 })),
      getMessage: jest.fn(async () => ({ id: 1, channel: 'in_app', status: 'sent', save: jest.fn(async () => undefined) })),
      listDeliveries: jest.fn(async () => []),
      cancelMessage: jest.fn(async () => ({ id: 1, status: 'cancelled' })),
      listTemplates: jest.fn(async () => ({ rows: [], count: 0 })),
      createTemplate: jest.fn(async () => ({ id: 2, code: 'C' })),
      updateTemplate: jest.fn(async () => ({ id: 2, code: 'C' })),
      getPreferences: jest.fn(async () => []),
      upsertPreferences: jest.fn(async () => []),
      listCustomerMessages: jest.fn(async () => ({ rows: [], count: 0 })),
      countUnreadCustomerMessages: jest.fn(async () => 3),
      getCustomerMessage: jest.fn(async () => ({ id: 1 })),
      markRead: jest.fn(async () => ({ id: 1, status: 'read' })),
      markAllCustomerRead: jest.fn(async () => 4),
      upsertDeviceToken: jest.fn(async () => ({ id: 5, customerId: 9 })),
      deactivateDeviceToken: jest.fn(async () => ({ id: 5, customerId: 9 })),
      listRecipientMessages: jest.fn(async () => ({ rows: [], count: 0 })),
      countUnreadMessages: jest.fn(async () => 2),
      getRecipientMessage: jest.fn(async () => ({ id: 1 })),
      markAllRecipientRead: jest.fn(async () => 6),
    };
    const orchestrator = { deliverMessage: jest.fn(async () => undefined) };
    const broadcastService = { broadcast: jest.fn(async () => ({ created: 3 })) };
    const service = new NotificationsService(repository as never, orchestrator as never, broadcastService as never);
    return { service, repository, orchestrator, broadcastService };
  }

  const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const internal = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;
  const noInternalId = { role: 'internal_operator', tenantId: '1' } as never;
  const q = { page: 1, limit: 10 } as never;

  it('broadcast delega en el broadcast service', async () => {
    const { service, broadcastService } = build();
    await service.broadcast('1', { title: 'x' } as never);
    expect(broadcastService.broadcast).toHaveBeenCalledWith('1', { title: 'x' });
  });

  it('listMessages y listTemplates paginan con totalPages = ceil(total/limit)', async () => {
    const { service, repository } = build();
    (repository.listMessages as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, channel: 'in_app', status: 'sent' }],
      count: 25,
    } as never);
    const res = await service.listMessages('1', { page: 1, limit: 10 } as never);
    expect(res.data).toHaveLength(1);
    expect(res.pagination).toMatchObject({ total: 25, totalPages: 3 });
    await service.listTemplates('1', q);
    expect(repository.listTemplates).toHaveBeenCalledTimes(1);
  });

  it('getMessage combina el mensaje con sus deliveries', async () => {
    const { service, repository } = build();
    (repository.getMessage as jest.Mock).mockResolvedValueOnce({ id: 7, channel: 'email', status: 'sent' } as never);
    (repository.listDeliveries as jest.Mock).mockResolvedValueOnce([
      { id: 1, notificationMessageId: 7, channel: 'email', status: 'sent', attemptNumber: 1 },
    ] as never);
    const res = await service.getMessage('1', '7');
    expect(res).toMatchObject({ id: '7' });
    expect(res.deliveries).toHaveLength(1);
  });

  it('retryMessage marca retrying, guarda, dispara el orchestrator y relee', async () => {
    const { service, repository, orchestrator } = build();
    const save = jest.fn(async () => undefined);
    (repository.getMessage as jest.Mock).mockResolvedValue({ id: 1, channel: 'in_app', status: 'failed', save } as never);
    await service.retryMessage('1', '1');
    expect(save).toHaveBeenCalledTimes(1);
    expect(orchestrator.deliverMessage).toHaveBeenCalledWith('1');
  });

  it('assertCustomerAccess: el customer solo accede a lo suyo; los internos a todo', async () => {
    const { service } = build();
    await expect(service.listCustomerNotifications('1', '9', q, customer)).resolves.toBeDefined();
    // customer '9' intentando leer el inbox del cliente '99' -> Forbidden
    await expect(service.listCustomerNotifications('1', '99', q, customer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.unreadCount('1', '55', internal)).resolves.toEqual({ unread: 3 });
  });

  it('los métodos de cliente con guarda delegan cuando el acceso es válido', async () => {
    const { service, repository } = build();
    await service.markCustomerNotificationRead('1', '9', 'n1', customer);
    await service.markAllCustomerNotificationsRead('1', '9', customer);
    await service.upsertDeviceToken('1', '9', { platform: 'ios' } as never, customer);
    await service.deactivateDeviceToken('1', '9', 'dt1', customer);
    expect(repository.markRead).toHaveBeenCalledTimes(1);
    expect(repository.markAllCustomerRead).toHaveBeenCalledTimes(1);
    expect(repository.upsertDeviceToken).toHaveBeenCalledTimes(1);
    expect(repository.deactivateDeviceToken).toHaveBeenCalledTimes(1);
  });

  it('el autoservicio interno exige internalUserId (Forbidden si falta)', async () => {
    const { service, repository } = build();
    await service.listMyNotifications('1', q, internal);
    expect(repository.listRecipientMessages).toHaveBeenCalledWith('1', 'internal_user', 'u1', q);
    await expect(service.listMyNotifications('1', q, noInternalId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.myUnreadCount('1', noInternalId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.markAllMyNotificationsRead('1', internal)).toEqual({ updated: 6 });
  });

  it('createTemplate/updateTemplate/getPreferences/updatePreferences/cancelMessage delegan y mapean', async () => {
    const { service, repository } = build();
    await service.createTemplate('1', { code: 'C' } as never);
    await service.updateTemplate('1', 't1', { code: 'C' } as never);
    await service.getPreferences('1', '9');
    await service.updatePreferences('1', '9', { preferences: [] } as never);
    await service.cancelMessage('1', 'm1');
    expect(repository.createTemplate).toHaveBeenCalledTimes(1);
    expect(repository.updateTemplate).toHaveBeenCalledTimes(1);
    expect(repository.upsertPreferences).toHaveBeenCalledTimes(1);
    expect(repository.cancelMessage).toHaveBeenCalledTimes(1);
  });
});
