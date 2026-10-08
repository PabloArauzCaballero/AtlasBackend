import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';

/**
 * `NotificationsService`: guardas de autorización propias (assertCustomerAccess / requireInternalUserId),
 * paginación (totalPages) y mapeo, más delegación a orchestrator/broadcast. Spec directo con repo y
 * colaboradores mockeados; los mappers corren de verdad.
 */
describe('NotificationsService', () => {
  function build() {
    const repository = {
      listMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      getMessage: jest.fn(async (..._args: unknown[]) => ({
        id: 1,
        channel: 'in_app',
        status: 'sent',
        save: jest.fn(async (..._args: unknown[]) => undefined),
      })),
      listDeliveries: jest.fn(async (..._args: unknown[]) => []),
      markMessageRetrying: jest.fn(async (..._args: unknown[]) => true),
      cancelMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1, status: 'cancelled' })),
      listTemplates: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      createTemplate: jest.fn(async (..._args: unknown[]) => ({ id: 2, code: 'C' })),
      updateTemplate: jest.fn(async (..._args: unknown[]) => ({ id: 2, code: 'C' })),
      getPreferences: jest.fn(async (..._args: unknown[]) => []),
      upsertPreferences: jest.fn(async (..._args: unknown[]) => []),
      listCustomerMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      countUnreadCustomerMessages: jest.fn(async (..._args: unknown[]) => 3),
      getCustomerMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1 })),
      markRead: jest.fn(async (..._args: unknown[]) => ({ id: 1, status: 'read' })),
      markAllCustomerRead: jest.fn(async (..._args: unknown[]) => 4),
      upsertDeviceToken: jest.fn(async (..._args: unknown[]) => ({ id: 5, customerId: 9 })),
      deactivateDeviceToken: jest.fn(async (..._args: unknown[]) => ({ id: 5, customerId: 9 })),
      listRecipientMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      countUnreadMessages: jest.fn(async (..._args: unknown[]) => 2),
      getRecipientMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1 })),
      markAllRecipientRead: jest.fn(async (..._args: unknown[]) => 6),
    };
    const orchestrator = { deliverMessage: jest.fn(async (..._args: unknown[]) => undefined) };
    const broadcastService = { broadcast: jest.fn(async (..._args: unknown[]) => ({ created: 3 })) };
    // El catalogo de politicas: es de donde salen ahora el nombre, la explicacion y la
    // obligatoriedad de cada aviso. Antes la pantalla solo enseñaba las filas ya guardadas del
    // cliente, asi que quien nunca la habia tocado recibia una lista vacia.
    const policies = { listActive: jest.fn(async (..._args: unknown[]) => []) };
    const service = new NotificationsService(
      repository as never,
      orchestrator as never,
      broadcastService as never,
      policies as never,
      {} as never,
    );
    return { service, repository, orchestrator, broadcastService, policies };
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

  it('retryMessage reabre el mensaje fallido, dispara el orchestrator y relee', async () => {
    const { service, repository, orchestrator } = build();
    const failed = { id: 1, channel: 'in_app', status: 'failed', save: jest.fn() };
    (repository.getMessage as jest.Mock).mockResolvedValue(failed as never);
    await service.retryMessage('1', '1');
    expect(repository.markMessageRetrying).toHaveBeenCalledWith(failed);
    expect(orchestrator.deliverMessage).toHaveBeenCalledWith('1');
  });

  it('retryMessage no reenvía un mensaje entregado, leído o cancelado: 409 MESSAGE_NOT_RETRYABLE', async () => {
    const { service, repository, orchestrator } = build();
    (repository.markMessageRetrying as jest.Mock).mockResolvedValueOnce(false as never);
    await expect(service.retryMessage('1', '1')).rejects.toBeInstanceOf(ConflictException);
    expect(orchestrator.deliverMessage).not.toHaveBeenCalled();
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

  it('registrar un token push es del propio cliente (o de system): un interno no puede colgar su teléfono de otro cliente', async () => {
    const { service, repository } = build();
    await expect(service.upsertDeviceToken('1', '555', { platform: 'android' } as never, internal)).rejects.toThrow(
      'DEVICE_TOKEN_OWNER_ONLY',
    );
    await expect(service.upsertDeviceToken('1', '99', { platform: 'android' } as never, customer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.upsertDeviceToken).not.toHaveBeenCalled();
    await service.upsertDeviceToken('1', '555', { platform: 'android' } as never, { role: 'system', tenantId: '1' } as never);
    // La baja sí la puede hacer el personal.
    await service.deactivateDeviceToken('1', '555', 'dt1', internal);
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
    const { service, repository, policies } = build();
    await service.createTemplate('1', { code: 'C' } as never);
    await service.updateTemplate('1', 't1', { code: 'C' } as never);
    await service.getPreferences('1', '9');
    await service.updatePreferences('1', '9', { preferences: [] } as never);
    await service.cancelMessage('1', 'm1');
    expect(repository.createTemplate).toHaveBeenCalledTimes(1);
    expect(repository.updateTemplate).toHaveBeenCalledTimes(1);
    expect(repository.upsertPreferences).toHaveBeenCalledTimes(1);
    expect(repository.cancelMessage).toHaveBeenCalledTimes(1);
    // Dos lecturas del catalogo: la consulta directa y la que devuelve `updatePreferences`, que
    // responde con la MISMA forma para que la app repinte sin quedarse en blanco tras guardar.
    expect(policies.listActive).toHaveBeenCalledTimes(2);
  });

  /*
   * La pantalla de avisos del cliente no ofrece un interruptor para un aviso que nadie envía. La mora y el
   * vencimiento no se avisan al deudor (decisión de producto pendiente): ofrecer «Tu cuota venció» como
   * aviso obligatorio prometía algo que ningún código cumplía.
   */
  it('getPreferences no ofrece las políticas cuyo aviso no se envía (cuota por vencer, cuota vencida)', async () => {
    const { service, policies, repository } = build();
    const politica = (eventCode: string, isMandatory = false) => ({
      eventCode,
      channel: 'push',
      label: eventCode,
      description: null,
      category: 'pagos',
      icon: null,
      isMandatory,
      mandatoryReason: isMandatory ? 'razón' : null,
      defaultEnabled: true,
      displayOrder: 10,
    });
    (policies.listActive as jest.Mock).mockResolvedValueOnce([
      politica('cuota_por_vencer'),
      politica('cuota_vencida', true),
      politica('pago_acreditado', true),
    ] as never);
    // Lo que el cliente ya había elegido para un aviso retirado no se borra ni se enseña como «legado».
    (repository.getPreferences as jest.Mock).mockResolvedValueOnce([
      { eventCode: 'cuota_vencida', channel: 'push', isEnabled: true, isRequired: true },
    ] as never);

    const result = await service.getPreferences('1', '9');

    expect(result.data.map((item) => item.eventCode)).toEqual(['pago_acreditado']);
    expect(result.legacy).toHaveLength(0);
  });
});
