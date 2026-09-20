import { describe, expect, it, jest } from '@jest/globals';
import { NotificationDeliveryStatusRepository } from '../../../src/modules/notifications/notification-delivery-status.repository.js';

/**
 * Gana el PRIMER estado terminal. Los proveedores reintentan sus webhooks y mandan varios estados
 * por mensaje, así que sin esa regla un reenvío de un evento viejo podría marcar como rebotado un
 * correo que consta entregado, y nadie podría distinguir cuál de los dos era cierto.
 */
describe('NotificationDeliveryStatusRepository', () => {
  function build(message: Record<string, unknown> | null = { status: 'sent', save: jest.fn() }) {
    const deliveryModel = { findOne: jest.fn() };
    const messageModel = { findByPk: jest.fn(async () => message) };
    return {
      repo: new NotificationDeliveryStatusRepository(deliveryModel as never, messageModel as never),
      deliveryModel,
      messageModel,
      message,
    };
  }

  const entrega = (status: string) => ({ status, notificationMessageId: '7', save: jest.fn(), deliveredAt: null, failedAt: null });

  it('busca la entrega por proveedor e identificador, quedándose con el último intento', async () => {
    const { repo, deliveryModel } = build();
    await repo.findByProviderMessageId('twilio_sms', 'SM1');
    expect(deliveryModel.findOne).toHaveBeenCalledWith({
      where: { provider: 'twilio_sms', providerMessageId: 'SM1' },
      order: [['attemptNumber', 'DESC']],
    });
  });

  it('escribe «entregado» en la entrega y arrastra el mensaje', async () => {
    const { repo, message } = build();
    const fila = entrega('sent');
    const cuando = new Date('2026-09-19T10:00:00Z');

    expect(await repo.applyOutcome(fila as never, { status: 'delivered', errorCode: null }, null, cuando)).toBe(true);
    expect(fila.status).toBe('delivered');
    expect(fila.deliveredAt).toBe(cuando);
    expect(fila.save).toHaveBeenCalled();
    expect(message?.status).toBe('delivered');
  });

  it('escribe el fallo con su código y su motivo', async () => {
    const { repo } = build();
    const fila = entrega('sent');
    const cuando = new Date();

    await repo.applyOutcome(fila as never, { status: 'failed', errorCode: 'TWILIO_30003' }, 'Unreachable destination', cuando);
    expect(fila).toMatchObject({ status: 'failed', errorCode: 'TWILIO_30003', errorMessage: 'Unreachable destination', failedAt: cuando });
  });

  it('un segundo aviso sobre una entrega ya cerrada no escribe nada', async () => {
    const { repo, messageModel } = build();
    const fila = entrega('delivered');

    expect(await repo.applyOutcome(fila as never, { status: 'failed', errorCode: 'SENDGRID_BOUNCE' }, null, new Date())).toBe(false);
    expect(fila.save).not.toHaveBeenCalled();
    expect(messageModel.findByPk).not.toHaveBeenCalled();
  });

  /**
   * `read` sólo lo pone el destinatario y vale más que cualquier cosa que diga el proveedor: si el
   * cliente ya abrió el aviso, un callback que llega tarde no lo devuelve a «entregado».
   */
  it('no degrada un mensaje que el destinatario ya leyó', async () => {
    const leido = { status: 'read', save: jest.fn() };
    const { repo } = build(leido);
    const fila = entrega('sent');

    expect(await repo.applyOutcome(fila as never, { status: 'delivered', errorCode: null }, null, new Date())).toBe(true);
    expect(leido.status).toBe('read');
    expect(leido.save).not.toHaveBeenCalled();
  });

  it('una entrega cuyo mensaje ya no existe no rompe el callback', async () => {
    const { repo } = build(null);
    const fila = entrega('sent');
    expect(await repo.applyOutcome(fila as never, { status: 'delivered', errorCode: null }, null, new Date())).toBe(true);
  });
});
