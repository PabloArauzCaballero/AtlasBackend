import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';

/**
 * Cobertura directa del núcleo de `NotificationsRepository` (Fase 1.2): NO es un delegador puro —
 * tiene la lógica real de mensajes (idempotencia + cifrado de delivery targets), entregas (conteo de
 * intento + transiciones de estado), device tokens (cifrado + upsert) y resolución de contactos. Los
 * utils de crypto corren de verdad (round-trip encrypt/decrypt). Modelos y sub-repos mockeados.
 */
describe('NotificationsRepository — núcleo', () => {
  function build() {
    const messageModel = { findOne: jest.fn(), create: jest.fn(async (v: unknown) => ({ id: 'm1', ...(v as object) })), findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })), count: jest.fn(), update: jest.fn() };
    const deliveryModel = { count: jest.fn(async () => 0), create: jest.fn(async (v: unknown) => ({ id: 'd1', ...(v as object) })), findAll: jest.fn(async () => []) };
    const deviceTokenModel = { findOne: jest.fn(), create: jest.fn(async (v: unknown) => ({ id: 'dt1', ...(v as object) })), findAll: jest.fn(async () => []) };
    const contactMethodModel = { findAll: jest.fn(async () => []) };
    const templatesRepository = { findTemplate: jest.fn(async () => null), listTemplates: jest.fn(async () => ({})), createTemplate: jest.fn(async () => ({})), updateTemplate: jest.fn(async () => ({})) };
    const preferencesRepository = { getPreferences: jest.fn(async () => []), upsertPreferences: jest.fn(async () => []), isChannelEnabled: jest.fn(async () => true) };
    const repo = new NotificationsRepository(
      messageModel as never,
      deliveryModel as never,
      deviceTokenModel as never,
      contactMethodModel as never,
      templatesRepository as never,
      preferencesRepository as never,
    );
    return { repo, messageModel, deliveryModel, deviceTokenModel, contactMethodModel, templatesRepository, preferencesRepository };
  }

  const baseMessage = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    tenantId: 't1',
    channel: 'email',
    status: 'pending',
    queuedAt: null,
    save: jest.fn(async () => undefined),
    ...over,
  });

  describe('createMessage', () => {
    it('devuelve el mensaje existente si la idempotencyKey ya existe (no crea otro)', async () => {
      const { repo, messageModel } = build();
      (messageModel.findOne as jest.Mock).mockResolvedValueOnce({ id: 'existing' } as never);
      const res = await repo.createMessage({ tenantId: 't1', idempotencyKey: 'k1', channel: 'email', body: 'b', payload: {}, recipientType: 'customer', recipientId: 'c1', outboxEventId: null, templateCode: null, subject: null, title: null, priority: 0 } as never);
      expect(res).toEqual({ id: 'existing' });
      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('crea el mensaje con status pending, payload redactado y delivery targets cifrados para email', async () => {
      const { repo, messageModel } = build();
      await repo.createMessage({ tenantId: 't1', channel: 'email', body: 'b', payload: { email: 'a@x.com' }, recipientType: 'customer', recipientId: 'c1', outboxEventId: null, templateCode: null, subject: 'S', title: 'T', priority: 5 } as never);
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

  it('listMessages arma el where con todos los filtros y el rango de fechas', async () => {
    const { repo, messageModel } = build();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');
    await repo.listMessages('t1', { status: 'sent', channel: 'email', recipientType: 'customer', recipientId: 'c1', correlationId: 'corr', from, to, page: 1, limit: 20 } as never);
    const where = (messageModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.where).toMatchObject({ tenantId: 't1', status: 'sent', channel: 'email', recipientType: 'customer', recipientId: 'c1', correlationId: 'corr' });
    expect(where.where.createdAtValue).toBeDefined();
  });

  it('markMessageSending fija status sending y queuedAt (solo la primera vez)', async () => {
    const { repo } = build();
    const message = baseMessage();
    await repo.markMessageSending(message as never);
    expect((message as { status: string }).status).toBe('sending');
    expect((message as { queuedAt: Date | null }).queuedAt).not.toBeNull();
    expect(message.save).toHaveBeenCalled();
  });

  describe('recordDelivery — cuenta el intento y transiciona el estado del mensaje', () => {
    it.each([
      ['sent', 'sent'],
      ['delivered', 'delivered'],
      ['failed', 'failed'],
    ])('resultado %s -> mensaje %s', async (resultStatus, expectedMessageStatus) => {
      const { repo, deliveryModel } = build();
      (deliveryModel.count as jest.Mock).mockResolvedValueOnce(2 as never);
      const message = baseMessage();
      const delivery = await repo.recordDelivery(
        message as never,
        { id: 'm1', channel: 'email', body: 'b', payload: {} } as never,
        { provider: 'resend', providerMessageId: 'p1', status: resultStatus, response: {} } as never,
      );
      expect((delivery as { attemptNumber: number }).attemptNumber).toBe(3); // count 2 + 1
      expect((message as { status: string }).status).toBe(expectedMessageStatus);
      expect(message.save).toHaveBeenCalled();
    });
  });

  it('listDeliveries filtra por mensaje y ordena por intento', async () => {
    const { repo, deliveryModel } = build();
    await repo.listDeliveries('t1', 'm1');
    expect((deliveryModel.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', notificationMessageId: 'm1' } });
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

  it('markRead marca el mensaje como leído', async () => {
    const { repo } = build();
    const message = baseMessage();
    await repo.markRead(message as never);
    expect((message as { status: string }).status).toBe('read');
    expect((message as { readAt: Date | null }).readAt).not.toBeNull();
  });

  describe('upsertDeviceToken', () => {
    it('reactiva y re-cifra un token existente en vez de crear otro', async () => {
      const { repo, deviceTokenModel } = build();
      const existing = { isActive: false, save: jest.fn(async () => undefined) };
      (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(existing as never);
      await repo.upsertDeviceToken('t1', 'c1', { token: 'tok-123', platform: 'ios', deviceId: 'd1' } as never);
      expect((existing as { isActive: boolean }).isActive).toBe(true);
      expect(existing.save).toHaveBeenCalled();
      expect(deviceTokenModel.create).not.toHaveBeenCalled();
    });

    it('crea un token nuevo (cifrado + last4) cuando no existe', async () => {
      const { repo, deviceTokenModel } = build();
      (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
      await repo.upsertDeviceToken('t1', 'c1', { token: 'token-abcd', platform: 'android' } as never);
      const created = (deviceTokenModel.create as jest.Mock).mock.calls[0][0] as { tokenLast4: string; isActive: boolean };
      expect(created.isActive).toBe(true);
      expect(created.tokenLast4).toBe('abcd');
    });
  });

  it('getMessageDeliveryTargets descifra los targets del mensaje (round-trip)', async () => {
    const { repo } = build();
    const encrypted = await encryptSecretEnvelope('a@x.com');
    const targets = await repo.getMessageDeliveryTargets({ deliveryTargetsJson: [{ kind: 'email', addressEncrypted: encrypted }] } as never);
    expect(targets).toEqual([{ kind: 'email', address: 'a@x.com' }]);
  });

  describe('getCustomerContactTargets', () => {
    it('devuelve [] sin tenant o para un canal sin tipo de contacto (push)', async () => {
      const { repo } = build();
      expect(await repo.getCustomerContactTargets(null, 'c1', 'email')).toEqual([]);
      expect(await repo.getCustomerContactTargets('t1', 'c1', 'push')).toEqual([]);
    });

    it('resuelve y deduplica los contactos descifrados del cliente', async () => {
      const { repo, contactMethodModel } = build();
      const enc = await encryptSecretEnvelope('a@x.com');
      (contactMethodModel.findAll as jest.Mock).mockResolvedValueOnce([
        { contactValueEncrypted: enc },
        { contactValueEncrypted: enc }, // mismo valor -> se deduplica
      ] as never);
      const targets = await repo.getCustomerContactTargets('t1', 'c1', 'email');
      expect(targets).toEqual([{ kind: 'email', address: 'a@x.com' }]);
    });
  });

  it('getActiveDeviceTokenSecrets descifra y deduplica los tokens activos', async () => {
    const { repo, deviceTokenModel } = build();
    const enc = await encryptSecretEnvelope('device-token-xyz');
    (deviceTokenModel.findAll as jest.Mock).mockResolvedValueOnce([{ tokenEncrypted: enc }, { tokenEncrypted: enc }] as never);
    expect(await repo.getActiveDeviceTokenSecrets('t1', 'c1')).toEqual(['device-token-xyz']);
    expect(await repo.getActiveDeviceTokenSecrets(null, 'c1')).toEqual([]);
  });

  it('deactivateDeviceToken lanza NotFound o desactiva y guarda', async () => {
    const { repo, deviceTokenModel } = build();
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(repo.deactivateDeviceToken('t1', 'c1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    const token = { isActive: true, save: jest.fn(async () => undefined) };
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(token as never);
    await repo.deactivateDeviceToken('t1', 'c1', 'dt1');
    expect((token as { isActive: boolean }).isActive).toBe(false);
    expect(token.save).toHaveBeenCalled();
  });

  it('delega plantillas y preferencias en sus sub-repos', async () => {
    const { repo, templatesRepository, preferencesRepository } = build();
    await repo.findTemplate({ tenantId: 't1', code: 'C', channel: 'email' } as never);
    await repo.listTemplates('t1', {} as never);
    await repo.createTemplate('t1', {} as never);
    await repo.updateTemplate('t1', 'id', {} as never);
    await repo.getPreferences('t1', 'c1');
    await repo.upsertPreferences('t1', 'c1', {} as never);
    await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'E', channel: 'email' } as never);
    expect(templatesRepository.findTemplate).toHaveBeenCalled();
    expect(templatesRepository.listTemplates).toHaveBeenCalledWith('t1', {});
    expect(templatesRepository.createTemplate).toHaveBeenCalled();
    expect(templatesRepository.updateTemplate).toHaveBeenCalledWith('t1', 'id', {});
    expect(preferencesRepository.getPreferences).toHaveBeenCalledWith('t1', 'c1');
    expect(preferencesRepository.upsertPreferences).toHaveBeenCalled();
    expect(preferencesRepository.isChannelEnabled).toHaveBeenCalled();
  });
});
