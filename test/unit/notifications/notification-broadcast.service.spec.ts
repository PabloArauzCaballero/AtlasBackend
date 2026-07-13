import { describe, expect, it, jest } from '@jest/globals';
import { NotificationBroadcastService } from '../../../src/modules/notifications/notification-broadcast.service.js';

/**
 * `NotificationBroadcastService` es el corazón de dos features nuevas: la notificación in-app
 * personalizada de admin (uno/muchos/todos los usuarios) y las alertas automáticas de
 * `SystemsHealthMonitorService` cuando una herramienta crítica cae. Ambas terminan en
 * `dispatch()` — bulkCreate de mensajes + entrega en lotes vía el orchestrator real (no un mock).
 */
function buildService(
  overrides: {
    notificationsRepository?: Record<string, jest.Mock>;
    orchestrator?: Record<string, jest.Mock>;
    customersRepository?: Record<string, jest.Mock>;
    internalRbacRepository?: Record<string, jest.Mock>;
    tenantModel?: Record<string, jest.Mock>;
  } = {},
) {
  const notificationsRepository = {
    createBroadcastMessages: jest.fn(async (recipients: Array<{ recipientId: string }>) =>
      recipients.map((r, i) => ({ id: `msg-${i}-${r.recipientId}` })),
    ),
    ...overrides.notificationsRepository,
  };
  const orchestrator = {
    deliverMessage: jest.fn(async () => undefined),
    ...overrides.orchestrator,
  };
  const customersRepository = {
    listActiveCustomerIds: jest.fn(async () => ['c1', 'c2']),
    ...overrides.customersRepository,
  };
  const internalRbacRepository = {
    listActiveInternalUserIds: jest.fn(async () => ['iu1', 'iu2']),
    ...overrides.internalRbacRepository,
  };
  const tenantModel = {
    findAll: jest.fn(async () => [{ id: 't1' }, { id: 't2' }]),
    ...overrides.tenantModel,
  };

  const service = new NotificationBroadcastService(
    notificationsRepository as never,
    orchestrator as never,
    customersRepository as never,
    internalRbacRepository as never,
    tenantModel as never,
  );

  return { service, notificationsRepository, orchestrator, customersRepository, internalRbacRepository, tenantModel };
}

const baseInput = { title: 'Mantenimiento programado', body: 'El sistema estará en mantenimiento a las 22:00.', priority: 10 };

describe('NotificationBroadcastService.broadcast', () => {
  it('audience "customers" without explicit ids targets every active customer of the tenant', async () => {
    const { service, notificationsRepository, customersRepository, internalRbacRepository } = buildService();

    await service.broadcast('t1', { ...baseInput, category: 'custom_broadcast', audience: 'customers' } as never);

    expect(customersRepository.listActiveCustomerIds).toHaveBeenCalledWith('t1');
    expect(internalRbacRepository.listActiveInternalUserIds).not.toHaveBeenCalled();
    const recipients = (notificationsRepository.createBroadcastMessages as jest.Mock).mock.calls[0][0] as Array<{
      recipientType: string;
      recipientId: string;
    }>;
    expect(recipients).toEqual([
      { recipientType: 'customer', recipientId: 'c1' },
      { recipientType: 'customer', recipientId: 'c2' },
    ]);
  });

  it('audience "both" combines active customers AND active internal users', async () => {
    const { service, notificationsRepository } = buildService();

    await service.broadcast('t1', { ...baseInput, category: 'custom_broadcast', audience: 'both' } as never);

    const recipients = (notificationsRepository.createBroadcastMessages as jest.Mock).mock.calls[0][0] as Array<{
      recipientType: string;
      recipientId: string;
    }>;
    expect(recipients).toHaveLength(4);
    expect(recipients.filter((r) => r.recipientType === 'customer')).toHaveLength(2);
    expect(recipients.filter((r) => r.recipientType === 'internal_user')).toHaveLength(2);
  });

  it('explicit customerIds overrides "all active customers" — targets ONLY the given ids', async () => {
    const { service, notificationsRepository, customersRepository } = buildService();

    await service.broadcast('t1', {
      ...baseInput,
      category: 'custom_broadcast',
      audience: 'customers',
      customerIds: ['c99'],
    } as never);

    expect(customersRepository.listActiveCustomerIds).not.toHaveBeenCalled();
    const recipients = (notificationsRepository.createBroadcastMessages as jest.Mock).mock.calls[0][0] as Array<{ recipientId: string }>;
    expect(recipients).toEqual([{ recipientType: 'customer', recipientId: 'c99' }]);
  });

  it('creates the messages in one bulk call and delivers each one via the real orchestrator', async () => {
    const { service, notificationsRepository, orchestrator } = buildService();

    const result = await service.broadcast('t1', { ...baseInput, category: 'custom_broadcast', audience: 'customers' } as never);

    expect(notificationsRepository.createBroadcastMessages).toHaveBeenCalledTimes(1);
    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(2);
    expect(result.targeted).toBe(2);
    expect(result.created).toBe(2);
    expect(result.broadcastId).toEqual(expect.any(String));
  });

  it('a failed delivery for one recipient does not stop the rest from being delivered', async () => {
    const orchestrator = {
      deliverMessage: jest
        .fn()
        .mockRejectedValueOnce(new Error('adapter blew up') as never)
        .mockResolvedValueOnce(undefined as never),
    };
    const { service } = buildService({ orchestrator });

    const result = await service.broadcast('t1', { ...baseInput, category: 'custom_broadcast', audience: 'customers' } as never);

    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(2);
  });

  it('returns targeted: 0, created: 0 without touching the repository when there are no recipients (empty customerIds handled upstream)', async () => {
    const customersRepository = { listActiveCustomerIds: jest.fn(async () => [] as string[]) };
    const { service, notificationsRepository } = buildService({ customersRepository });

    const result = await service.broadcast('t1', { ...baseInput, category: 'custom_broadcast', audience: 'customers' } as never);

    expect(notificationsRepository.createBroadcastMessages).not.toHaveBeenCalled();
    expect(result).toMatchObject({ targeted: 0, created: 0 });
  });
});

describe('NotificationBroadcastService.notifyAllInternalUsers', () => {
  const alertContent = { title: 'Servicio caído: PostgreSQL', body: 'PostgreSQL no responde.', priority: 100, category: 'system_alert' };

  it('with a specific tenantId, only notifies that tenant — does not query the tenants table', async () => {
    const { service, internalRbacRepository, tenantModel } = buildService();

    const results = await service.notifyAllInternalUsers('t1', alertContent);

    expect(tenantModel.findAll).not.toHaveBeenCalled();
    expect(internalRbacRepository.listActiveInternalUserIds).toHaveBeenCalledTimes(1);
    expect(internalRbacRepository.listActiveInternalUserIds).toHaveBeenCalledWith('t1');
    expect(results).toHaveLength(1);
  });

  it('with tenantId: null, fans out to every active tenant (platform-wide infra alert)', async () => {
    const { service, internalRbacRepository, tenantModel } = buildService();

    const results = await service.notifyAllInternalUsers(null, alertContent);

    expect(tenantModel.findAll).toHaveBeenCalledTimes(1);
    expect(internalRbacRepository.listActiveInternalUserIds).toHaveBeenCalledTimes(2);
    expect(internalRbacRepository.listActiveInternalUserIds).toHaveBeenCalledWith('t1');
    expect(internalRbacRepository.listActiveInternalUserIds).toHaveBeenCalledWith('t2');
    expect(results).toHaveLength(2);
  });

  it('only targets internal_user recipients, never customers, even when customers exist', async () => {
    const { service, notificationsRepository } = buildService();

    await service.notifyAllInternalUsers('t1', alertContent);

    const recipients = (notificationsRepository.createBroadcastMessages as jest.Mock).mock.calls[0][0] as Array<{
      recipientType: string;
    }>;
    expect(recipients.every((r) => r.recipientType === 'internal_user')).toBe(true);
  });
});
