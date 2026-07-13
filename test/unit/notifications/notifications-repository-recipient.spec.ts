import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';

/**
 * `getCustomerMessage`/`listCustomerMessages`/`countUnreadCustomerMessages`/`markAllCustomerRead`
 * se generalizaron a `getRecipientMessage`/`listRecipientMessages`/`countUnreadMessages`/
 * `markAllRecipientRead` (parametrizados por `recipientType`) para que el mismo inbox in-app
 * sirva también a `internal_user` (autoservicio `internal-users/me/notifications*`), sin duplicar
 * la lógica de query cuatro veces. Estos tests fijan que:
 * 1) los métodos nuevos filtran por el `recipientType` que se les pasa (no siempre 'customer'), y
 * 2) los métodos viejos de customer siguen funcionando exactamente igual (son wrappers).
 */
function buildRepository(messageModel: Record<string, jest.Mock>) {
  return new NotificationsRepository(
    {} as never, // templateModel
    messageModel as never,
    {} as never, // deliveryModel
    {} as never, // preferenceModel
    {} as never, // deviceTokenModel
    {} as never, // contactMethodModel
  );
}

describe('NotificationsRepository — generalized recipient inbox methods', () => {
  describe('getRecipientMessage / getCustomerMessage', () => {
    it('getRecipientMessage filters by the given recipientType, not hardcoded to customer', async () => {
      const messageModel = { findOne: jest.fn(async () => ({ id: 'm1' })) };
      const repository = buildRepository(messageModel);

      await repository.getRecipientMessage('t1', 'internal_user', 'iu1', 'm1');

      expect(messageModel.findOne).toHaveBeenCalledWith({
        where: { tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', id: 'm1' },
      });
    });

    it('getRecipientMessage throws NotFoundException with the given code when nothing matches', async () => {
      const messageModel = { findOne: jest.fn(async () => null) };
      const repository = buildRepository(messageModel);

      await expect(repository.getRecipientMessage('t1', 'internal_user', 'iu1', 'missing', 'NOTIFICATION_NOT_FOUND')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getCustomerMessage (regression) still hardcodes recipientType: customer', async () => {
      const messageModel = { findOne: jest.fn(async () => ({ id: 'm1' })) };
      const repository = buildRepository(messageModel);

      await repository.getCustomerMessage('t1', 'c1', 'm1');

      expect(messageModel.findOne).toHaveBeenCalledWith({
        where: { tenantId: 't1', recipientType: 'customer', recipientId: 'c1', id: 'm1' },
      });
    });

    it('getCustomerMessage (regression) still throws CUSTOMER_NOTIFICATION_NOT_FOUND, not the generic code', async () => {
      const messageModel = { findOne: jest.fn(async () => null) };
      const repository = buildRepository(messageModel);

      await expect(repository.getCustomerMessage('t1', 'c1', 'missing')).rejects.toThrow('CUSTOMER_NOTIFICATION_NOT_FOUND');
    });
  });

  describe('listRecipientMessages / listCustomerMessages', () => {
    it('listRecipientMessages filters by the given recipientType and always channel: in_app', async () => {
      const messageModel = { findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })) };
      const repository = buildRepository(messageModel);

      await repository.listRecipientMessages('t1', 'internal_user', 'iu1', { page: 1, limit: 20 } as never);

      const callArgs = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArgs.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', channel: 'in_app' });
    });

    it('listCustomerMessages (regression) delegates to listRecipientMessages with recipientType: customer', async () => {
      const messageModel = { findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })) };
      const repository = buildRepository(messageModel);

      await repository.listCustomerMessages('t1', 'c1', { page: 2, limit: 10 } as never);

      const callArgs = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArgs.where).toMatchObject({ tenantId: 't1', recipientType: 'customer', recipientId: 'c1' });
    });
  });

  describe('countUnreadMessages / countUnreadCustomerMessages', () => {
    it('countUnreadMessages counts unread in_app messages for the given recipientType/recipientId', async () => {
      const messageModel = { count: jest.fn(async () => 3) };
      const repository = buildRepository(messageModel);

      const unread = await repository.countUnreadMessages('t1', 'internal_user', 'iu1');

      expect(unread).toBe(3);
      const callArgs = (messageModel.count as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArgs.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', readAt: null });
    });
  });

  describe('markAllRecipientRead / markAllCustomerRead', () => {
    it('markAllRecipientRead marks all unread in_app messages of the given recipient as read', async () => {
      const messageModel = { update: jest.fn(async () => [5]) };
      const repository = buildRepository(messageModel);

      const updated = await repository.markAllRecipientRead('t1', 'internal_user', 'iu1');

      expect(updated).toBe(5);
      const [values, options] = (messageModel.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      expect(values).toMatchObject({ status: 'read' });
      expect(options.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', readAt: null });
    });
  });

  describe('createBroadcastMessages', () => {
    it('returns [] without calling bulkCreate when there are no recipients', async () => {
      const messageModel = { bulkCreate: jest.fn(async () => []) };
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
      const messageModel = { bulkCreate: jest.fn(async (rows: unknown[]) => rows.map((r, i) => ({ id: `m${i}`, ...(r as object) }))) };
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
});
