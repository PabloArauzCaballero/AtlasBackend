import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationMessagesRepository } from '../../../src/modules/notifications/notification-messages.repository.js';

/**
 * Lógica real de mensajes: idempotencia, cifrado de delivery targets, reclamo compare-and-set,
 * cancelación y búsqueda de varados. Los utils de crypto corren de verdad; el modelo va mockeado.
 */
describe('NotificationMessagesRepository', () => {
  function build() {
    const messageModel = {
      findOne: jest.fn(),
      create: jest.fn(async (v: unknown) => ({ id: 'm1', ...(v as object) })),
      findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      findAll: jest.fn(async (..._args: unknown[]) => []),
      update: jest.fn(),
    };
    const repo = new NotificationMessagesRepository(messageModel as never);
    return { repo, messageModel };
  }

  const baseMessage = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    tenantId: 't1',
    channel: 'email',
    status: 'pending',
    queuedAt: null,
    save: jest.fn(async (..._args: unknown[]) => undefined),
    ...over,
  });

  describe('createMessage', () => {
    it('devuelve el mensaje existente si la idempotencyKey ya existe (no crea otro)', async () => {
      const { repo, messageModel } = build();
      (messageModel.findOne as jest.Mock).mockResolvedValueOnce({ id: 'existing' } as never);
      const res = await repo.createMessage({
        tenantId: 't1',
        idempotencyKey: 'k1',
        channel: 'email',
        body: 'b',
        payload: {},
        recipientType: 'customer',
        recipientId: 'c1',
        outboxEventId: null,
        templateCode: null,
        subject: null,
        title: null,
        priority: 0,
      } as never);
      expect(res).toEqual({ id: 'existing' });
      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('crea el mensaje con status pending, payload redactado y delivery targets cifrados para email', async () => {
      const { repo, messageModel } = build();
      await repo.createMessage({
        tenantId: 't1',
        channel: 'email',
        body: 'b',
        payload: { email: 'a@x.com' },
        recipientType: 'customer',
        recipientId: 'c1',
        outboxEventId: null,
        templateCode: null,
        subject: 'S',
        title: 'T',
        priority: 5,
      } as never);
      const created = (messageModel.create as jest.Mock).mock.calls[0][0] as { status: string; deliveryTargetsJson: unknown[] };
      expect(created.status).toBe('pending');
      expect(created.deliveryTargetsJson).toHaveLength(1);
      expect((created.deliveryTargetsJson[0] as { kind: string; last4: string }).kind).toBe('email');
    });
  });

  it('getMessage / getMessageForDelivery lanzan NotFound o devuelven el mensaje', async () => {
    const { repo, messageModel } = build();
    (messageModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await expect(repo.getMessage('t1', 'm1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(repo.getMessageForDelivery('m1')).rejects.toBeInstanceOf(NotFoundException);
    (messageModel.findOne as jest.Mock).mockResolvedValueOnce({ id: 'm1' } as never);
    expect(await repo.getMessage('t1', 'm1')).toMatchObject({ id: 'm1' });
  });

  it('listMessages busca por partes en correlation ID, plantilla, título y asunto', async () => {
    const { repo, messageModel } = build();
    await repo.listMessages('t1', { q: 'otp', page: 1, limit: 20 } as never);
    const where = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<symbol, unknown[]> };
    expect(where.where[Op.and]).toEqual([
      {
        [Op.or]: [
          { correlationId: { [Op.iLike]: '%otp%' } },
          { templateCode: { [Op.iLike]: '%otp%' } },
          { title: { [Op.iLike]: '%otp%' } },
          { subject: { [Op.iLike]: '%otp%' } },
        ],
      },
    ]);
  });

  it('listMessages arma el where con todos los filtros y el rango de fechas', async () => {
    const { repo, messageModel } = build();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');
    await repo.listMessages('t1', {
      status: 'sent',
      channel: 'email',
      recipientType: 'customer',
      recipientId: 'c1',
      correlationId: 'corr',
      from,
      to,
      page: 1,
      limit: 20,
    } as never);
    const where = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.where).toMatchObject({
      tenantId: 't1',
      status: 'sent',
      channel: 'email',
      recipientType: 'customer',
      recipientId: 'c1',
      correlationId: 'corr',
    });
    expect(where.where.createdAtValue).toBeDefined();
  });

  it('markMessageSending reclama con compare-and-set sobre el estado leído y fija sending y queuedAt', async () => {
    const { repo, messageModel } = build();
    (messageModel.update as jest.Mock).mockResolvedValueOnce([1] as never);
    const message = baseMessage();
    const previousStatus = (message as { status: string }).status;
    await expect(repo.markMessageSending(message as never)).resolves.toBe(true);
    const [values, options] = (messageModel.update as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      { where: Record<string, unknown> },
    ];
    expect(values.status).toBe('sending');
    expect(options.where).toEqual({ id: (message as { id: unknown }).id, status: previousStatus });
    expect((message as { status: string }).status).toBe('sending');
    expect((message as { queuedAt: Date | null }).queuedAt).not.toBeNull();
  });

  it('markMessageRetrying sólo reabre mensajes failed o retrying del tenant', async () => {
    const { repo, messageModel } = build();
    (messageModel.update as jest.Mock).mockResolvedValueOnce([1] as never).mockResolvedValueOnce([0] as never);
    const message = baseMessage({ status: 'failed' });
    await expect(repo.markMessageRetrying(message as never)).resolves.toBe(true);
    const [values, options] = (messageModel.update as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      { where: { status: Record<symbol, string[]> } },
    ];
    expect(values).toMatchObject({ status: 'retrying', failedAt: null });
    const statuses = Object.getOwnPropertySymbols(options.where.status).map((symbol) => options.where.status[symbol])[0];
    expect(statuses).toEqual(['failed', 'retrying']);
    await expect(repo.markMessageRetrying(baseMessage({ status: 'delivered' }) as never)).resolves.toBe(false);
  });

  it('markMessageSending devuelve false y no toca el mensaje si otra tanda ya lo reclamó', async () => {
    const { repo, messageModel } = build();
    (messageModel.update as jest.Mock).mockResolvedValueOnce([0] as never);
    const message = baseMessage();
    const previousStatus = (message as { status: string }).status;
    await expect(repo.markMessageSending(message as never)).resolves.toBe(false);
    expect((message as { status: string }).status).toBe(previousStatus);
  });

  describe('cancelMessage', () => {
    it('cancela un mensaje pendiente', async () => {
      const { repo, messageModel } = build();
      const message = baseMessage({ status: 'pending' });
      (messageModel.findOne as jest.Mock).mockResolvedValueOnce(message as never);
      const res = await repo.cancelMessage('t1', 'm1');
      expect((res as { status: string }).status).toBe('cancelled');
    });

    it('rechaza cancelar un mensaje ya enviado', async () => {
      const { repo, messageModel } = build();
      (messageModel.findOne as jest.Mock).mockResolvedValueOnce(baseMessage({ status: 'sent' }) as never);
      await expect(repo.cancelMessage('t1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('matriz de canales y descifrado de destinos', () => {
    it.each([
      ['sms', { phone: '+591700' }, 'phone'],
      ['whatsapp', { whatsappTo: '+591700' }, 'whatsapp'],
      ['push', { fcmToken: 'tok-1' }, 'fcm_token'],
    ])('createMessage para %s cifra el destino con kind %s', async (channel, payload, kind) => {
      const { repo, messageModel } = build();
      await repo.createMessage({
        tenantId: 't1',
        channel,
        body: 'b',
        payload,
        recipientType: 'customer',
        recipientId: 'c1',
        outboxEventId: null,
        templateCode: null,
        subject: null,
        title: null,
        priority: 0,
      } as never);
      const targets = ((messageModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>).deliveryTargetsJson as Array<{
        kind: string;
      }>;
      expect(targets).toHaveLength(1);
      expect(targets[0].kind).toBe(kind);
      // Auditoría 2026-10-09: sin huella SHA-256 sin clave del destino (nadie la leía y un teléfono se revierte).
      expect(Object.keys(targets[0]).sort()).toEqual(['addressEncrypted', 'kind', 'last4']);
      expect(JSON.stringify(targets[0])).not.toContain('+591700');
    });

    it('in_app no tiene destino que cifrar, y un canal con destino ausente tampoco', async () => {
      const { repo, messageModel } = build();
      await repo.createMessage({
        tenantId: 't1',
        channel: 'in_app',
        body: 'b',
        payload: { email: 'a@x.com' },
        recipientType: 'customer',
        recipientId: 'c1',
        outboxEventId: null,
        templateCode: null,
        subject: null,
        title: null,
        priority: 0,
      } as never);
      expect(((messageModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>).deliveryTargetsJson).toEqual([]);

      await repo.createMessage({
        tenantId: 't1',
        channel: 'email',
        body: 'b',
        payload: {},
        recipientType: 'customer',
        recipientId: 'c1',
        outboxEventId: null,
        templateCode: null,
        subject: null,
        title: null,
        priority: 0,
      } as never);
      expect(((messageModel.create as jest.Mock).mock.calls[1][0] as Record<string, unknown>).deliveryTargetsJson).toEqual([]);
    });
  });

  describe('rangos de fecha parciales en los listados', () => {
    it('listMessages acepta solo "from" o solo "to"', async () => {
      const { repo, messageModel } = build();
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');
      await repo.listMessages('t1', { from, page: 1, limit: 20 } as never);
      expect(
        ((messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> }).where.createdAtValue,
      ).toBeDefined();
      await repo.listMessages('t1', { to, page: 1, limit: 20 } as never);
      expect(
        ((messageModel.findAndCountAll as jest.Mock).mock.calls[1][0] as { where: Record<string, unknown> }).where.createdAtValue,
      ).toBeDefined();
    });
  });

  /**
   * Hallazgo A-03: la entrega de un broadcast corre fuera del request, así que un reinicio a mitad
   * de tanda dejaba mensajes creados en `pending` que nadie volvía a intentar. `sending` entra
   * también: es el estado intermedio donde un proceso muerto deja el mensaje clavado.
   */
  describe('listStuckMessages', () => {
    it('recoge pending y sending anteriores al corte, del tenant, y los más viejos primero', async () => {
      const { repo, messageModel } = build();

      await repo.listStuckMessages({ tenantId: 't1', olderThanMinutes: 15, limit: 50 });

      const call = (messageModel.findAll as jest.Mock).mock.calls[0][0] as {
        where: { tenantId: string; status: Record<symbol, string[]>; createdAtValue: Record<symbol, Date> };
        order: [string, string][];
        limit: number;
      };
      expect(call.where.tenantId).toBe('t1');
      const statuses = Object.getOwnPropertySymbols(call.where.status).map((symbol) => call.where.status[symbol])[0];
      expect(statuses).toEqual(['pending', 'sending']);
      expect(call.order).toEqual([['createdAtValue', 'ASC']]);
      expect(call.limit).toBe(50);
    });

    it('el job de pendientes puede pedir sólo pending: un sending reciente es una entrega en vuelo', async () => {
      const { repo, messageModel } = build();

      await repo.listStuckMessages({ tenantId: 't1', olderThanMinutes: 0, limit: 50, statuses: ['pending'] });

      const call = (messageModel.findAll as jest.Mock).mock.calls[0][0] as { where: { status: Record<symbol, string[]> } };
      const statuses = Object.getOwnPropertySymbols(call.where.status).map((symbol) => call.where.status[symbol])[0];
      expect(statuses).toEqual(['pending']);
    });

    it('el corte por antigüedad no recoge lo que acaba de crearse', async () => {
      const { repo, messageModel } = build();
      const before = Date.now();

      await repo.listStuckMessages({ tenantId: 't1', olderThanMinutes: 15, limit: 10 });

      const call = (messageModel.findAll as jest.Mock).mock.calls[0][0] as {
        where: { createdAtValue: Record<symbol, Date> };
      };
      const cutoff = Object.getOwnPropertySymbols(call.where.createdAtValue).map((symbol) => call.where.createdAtValue[symbol])[0] as Date;
      // Debe quedar ~15 minutos por detrás del momento de la llamada, nunca en el futuro.
      expect(cutoff.getTime()).toBeLessThanOrEqual(before - 15 * 60_000 + 1_000);
      expect(cutoff.getTime()).toBeGreaterThan(before - 16 * 60_000);
    });
  });
});
