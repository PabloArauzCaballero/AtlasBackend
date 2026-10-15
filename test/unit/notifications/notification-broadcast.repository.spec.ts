import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { NotificationBroadcastRepository } from '../../../src/modules/notifications/notification-broadcast.repository.js';

function buildRepository(messageModel: Record<string, unknown>) {
  return new NotificationBroadcastRepository(messageModel as never);
}

describe('NotificationBroadcastRepository.createBroadcastMessages', () => {
  it('returns [] without calling bulkCreate when there are no recipients', async () => {
    const messageModel = { bulkCreate: jest.fn(async (..._args: unknown[]) => []) };
    const repository = buildRepository(messageModel);

    const result = await repository.createBroadcastMessages([], {
      tenantId: 't1',
      title: 'x',
      body: 'y',
      priority: 0,
      category: null,
      icon: null,
      correlationId: null,
    });

    expect(result).toEqual([]);
    expect(messageModel.bulkCreate).not.toHaveBeenCalled();
  });

  it('bulkCreate is called once with one row per recipient, all channel: in_app and pending', async () => {
    const messageModel = { bulkCreate: asyncMock() };
    messageModel.bulkCreate.mockImplementation(async (...args: unknown[]) =>
      (args[0] as unknown[]).map((r, i) => ({ id: `m${i}`, ...(r as object) })),
    );
    const repository = buildRepository(messageModel);

    await repository.createBroadcastMessages(
      [
        { recipientType: 'customer', recipientId: 'c1' },
        { recipientType: 'internal_user', recipientId: 'iu1' },
      ],
      { tenantId: 't1', title: 'Aviso', body: 'Cuerpo', priority: 50, category: 'system_alert', icon: 'bell', correlationId: 'corr-1' },
    );

    expect(messageModel.bulkCreate).toHaveBeenCalledTimes(1);
    const rows = (messageModel.bulkCreate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      recipientType: 'customer',
      recipientId: 'c1',
      channel: 'in_app',
      status: 'pending',
      title: 'Aviso',
      priority: 50,
      category: 'system_alert',
      icon: 'bell',
      correlationId: 'corr-1',
    });
    expect(rows[1]).toMatchObject({ recipientType: 'internal_user', recipientId: 'iu1' });
  });
});
