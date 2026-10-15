import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { NotFoundException } from '@nestjs/common';
import { NotificationInboxRepository } from '../../../src/modules/notifications/notification-inbox.repository.js';

/**
 * El mismo inbox in-app sirve a `customer` y a `internal_user` (autoservicio
 * `internal-users/me/notifications*`): estos tests fijan que las consultas filtran por el
 * `recipientType` que se les pasa (no siempre 'customer') y que la bandeja oculta lo no entregable.
 */
function buildRepository(messageModel: Record<string, unknown>) {
  return new NotificationInboxRepository(messageModel as never);
}

describe('NotificationInboxRepository', () => {
  describe('getRecipientMessage', () => {
    it('getRecipientMessage filters by the given recipientType, not hardcoded to customer', async () => {
      const messageModel = { findOne: jest.fn(async (..._args: unknown[]) => ({ id: 'm1' })) };
      const repository = buildRepository(messageModel);

      await repository.getRecipientMessage('t1', 'internal_user', 'iu1', 'm1');

      expect(messageModel.findOne).toHaveBeenCalledWith({
        where: { tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', id: 'm1' },
      });
    });

    it('getRecipientMessage throws NotFoundException with the given code when nothing matches', async () => {
      const messageModel = { findOne: jest.fn(async (..._args: unknown[]) => null) };
      const repository = buildRepository(messageModel);

      await expect(repository.getRecipientMessage('t1', 'internal_user', 'iu1', 'missing', 'NOTIFICATION_NOT_FOUND')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listRecipientMessages', () => {
    it('listRecipientMessages filters by the given recipientType and always channel: in_app', async () => {
      const messageModel = { findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })) };
      const repository = buildRepository(messageModel);

      await repository.listRecipientMessages('t1', 'internal_user', 'iu1', { page: 1, limit: 20 } as never);

      const callArgs = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArgs.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', channel: 'in_app' });
    });

    it('listRecipientMessages busca en título, asunto y texto SIN perder el filtro de vigencia', async () => {
      const messageModel = { findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })) };
      const repository = buildRepository(messageModel);
      await repository.listRecipientMessages('t1', 'internal_user', 'iu1', { q: 'caída', page: 1, limit: 20 } as never);
      const callArgs = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<symbol, unknown[]> };
      const condiciones = callArgs.where[Op.and];
      expect(condiciones).toHaveLength(2);
      expect((condiciones[0] as Record<symbol, unknown[]>)[Op.or]).toContainEqual({ expiresAt: null });
      expect(condiciones[1]).toEqual({
        [Op.or]: [{ title: { [Op.iLike]: '%caída%' } }, { subject: { [Op.iLike]: '%caída%' } }, { body: { [Op.iLike]: '%caída%' } }],
      });
    });

    it('la bandeja no lista avisos pendientes, cancelados ni fallidos, ni siquiera pidiéndolos por status', async () => {
      const messageModel = { findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })) };
      const repository = buildRepository(messageModel);

      await repository.listRecipientMessages('t1', 'customer', 'c1', { page: 1, limit: 20 } as never);
      await repository.listRecipientMessages('t1', 'customer', 'c1', { status: 'cancelled', page: 1, limit: 20 } as never);
      await repository.listRecipientMessages('t1', 'customer', 'c1', { status: 'delivered', page: 1, limit: 20 } as never);

      const wheres = (messageModel.findAndCountAll as jest.Mock).mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
      expect(wheres[0].status).toEqual({ [Op.notIn]: ['pending', 'cancelled', 'failed'] });
      expect(wheres[1].status).toEqual({ [Op.in]: [] });
      expect(wheres[2].status).toBe('delivered');
    });
  });

  describe('countUnreadMessages', () => {
    it('countUnreadMessages counts unread in_app messages for the given recipientType/recipientId', async () => {
      const messageModel = { count: jest.fn(async (..._args: unknown[]) => 3) };
      const repository = buildRepository(messageModel);

      const unread = await repository.countUnreadMessages('t1', 'internal_user', 'iu1');

      expect(unread).toBe(3);
      const callArgs = (messageModel.count as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArgs.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', readAt: null });
    });
  });

  describe('markAllRecipientRead', () => {
    it('markAllRecipientRead marks all unread in_app messages of the given recipient as read', async () => {
      const messageModel = { update: jest.fn(async (..._args: unknown[]) => [5]) };
      const repository = buildRepository(messageModel);

      const updated = await repository.markAllRecipientRead('t1', 'internal_user', 'iu1');

      expect(updated).toBe(5);
      const [values, options] = (messageModel.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      expect(values).toMatchObject({ status: 'read' });
      expect(options.where).toMatchObject({ tenantId: 't1', recipientType: 'internal_user', recipientId: 'iu1', readAt: null });
      expect(options.where.status).toEqual({ [Op.notIn]: ['pending', 'cancelled', 'failed'] });
    });
  });

  it('markRead marca el mensaje como leído', async () => {
    const repository = buildRepository({});
    const message = {
      status: 'sent',
      readAt: null as Date | null,
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    await repository.markRead(message as never);
    expect(message.status).toBe('read');
    expect(message.readAt).not.toBeNull();
    expect(message.save).toHaveBeenCalled();
  });

  it('listRecipientMessages aplica status, channel y el rango de fechas', async () => {
    const messageModel = { findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })) };
    const repository = buildRepository(messageModel);
    await repository.listRecipientMessages('t1', 'customer', 'c1', {
      status: 'read',
      channel: 'in_app',
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
      page: 1,
      limit: 20,
    } as never);
    const where = ((messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as Record<string, unknown>).where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({ status: 'read', channel: 'in_app' });
    expect(where.createdAtValue).toBeDefined();
  });
});
