import { describe, expect, it, jest } from '@jest/globals';
import { NotificationProviderCallbacksService } from '../../../src/modules/notifications/notification-provider-callbacks.service.js';
import {
  sendGridBaseMessageId,
  sendGridOutcome,
  twilioOutcome,
} from '../../../src/modules/notifications/adapters/provider-delivery-status.util.js';

/**
 * El callback es lo único que distingue «el proveedor lo aceptó» de «llegó al destinatario». Sin él
 * toda entrega se quedaba en `sent` para siempre y un número apagado se veía igual que uno que
 * recibió el mensaje.
 */
describe('mapeo de estados del proveedor', () => {
  it('Twilio: sólo los estados terminales son noticia', () => {
    expect(twilioOutcome('delivered')).toEqual({ status: 'delivered', errorCode: null });
    expect(twilioOutcome('undelivered', '30003')).toEqual({ status: 'failed', errorCode: 'TWILIO_30003' });
    expect(twilioOutcome('failed')).toEqual({ status: 'failed', errorCode: 'TWILIO_FAILED' });
    // `queued`/`sent`/`sending` repiten lo que ya sabíamos al enviar: escribirlos pisaría un desenlace.
    expect(twilioOutcome('queued')).toBeNull();
    expect(twilioOutcome('sent')).toBeNull();
    expect(twilioOutcome(undefined)).toBeNull();
  });

  it('SendGrid: `deferred` no es un fallo y `open`/`spamreport` no hablan de la entrega', () => {
    expect(sendGridOutcome('delivered')).toEqual({ status: 'delivered', errorCode: null });
    expect(sendGridOutcome('bounce')).toEqual({ status: 'failed', errorCode: 'SENDGRID_BOUNCE' });
    expect(sendGridOutcome('dropped')).toEqual({ status: 'failed', errorCode: 'SENDGRID_DROPPED' });
    expect(sendGridOutcome('deferred')).toBeNull();
    expect(sendGridOutcome('processed')).toBeNull();
    expect(sendGridOutcome('open')).toBeNull();
    expect(sendGridOutcome('spamreport')).toBeNull();
  });

  it('SendGrid decora el id en los eventos: hay que quedarse con la base', () => {
    expect(sendGridBaseMessageId('abc123.filterdrecv-abcd-1')).toBe('abc123');
    expect(sendGridBaseMessageId('abc123')).toBe('abc123');
    expect(sendGridBaseMessageId(undefined)).toBeNull();
  });
});

describe('NotificationProviderCallbacksService', () => {
  function build() {
    const deliveries = {
      findByProviderMessageId: jest.fn(),
      findLatestByMessageId: jest.fn(),
      applyOutcome: jest.fn(),
    };
    return { service: new NotificationProviderCallbacksService(deliveries as never), deliveries };
  }

  const entrega = { id: '9', status: 'sent' };

  it('Twilio: aplica el desenlace a la entrega que lleva ese sid', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(true as never);

    expect(await service.applyTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })).toEqual({
      applied: true,
      reason: 'delivered',
    });
    expect(deliveries.findByProviderMessageId).toHaveBeenCalledWith('twilio_sms', 'SM1');
  });

  it('Twilio: si el sid no es de un SMS, busca también entre los de WhatsApp', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValueOnce(null as never).mockResolvedValueOnce(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(true as never);

    expect((await service.applyTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })).applied).toBe(true);
    expect(deliveries.findByProviderMessageId).toHaveBeenLastCalledWith('twilio_whatsapp', 'SM1');
  });

  /**
   * Twilio manda varios avisos por mensaje y reintenta el que no conteste 2xx. Que la mayoría no
   * cambie nada es lo NORMAL, y por eso ninguna de estas salidas es una excepción: un 5xx aquí hace
   * que Twilio reintente en bucle un aviso que nunca se va a poder aplicar.
   */
  it('Twilio: sin sid, con estado intermedio o sin entrega, no escribe y explica por qué', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(null as never);

    expect(await service.applyTwilioStatus({ MessageStatus: 'delivered' })).toEqual({ applied: false, reason: 'FALTA_MESSAGE_SID' });
    expect(await service.applyTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'queued' })).toEqual({
      applied: false,
      reason: 'ESTADO_NO_TERMINAL',
    });
    expect(await service.applyTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })).toEqual({
      applied: false,
      reason: 'ENTREGA_NO_ENCONTRADA',
    });
    expect(deliveries.applyOutcome).not.toHaveBeenCalled();
  });

  it('Twilio: un aviso repetido sobre una entrega ya cerrada se reporta como tal', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(false as never);

    expect(await service.applyTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })).toEqual({
      applied: false,
      reason: 'YA_TENIA_ESTADO_FINAL',
    });
  });

  it('SendGrid: busca primero por el id de ATLAS de custom_args y sólo después por el del proveedor', async () => {
    const { service, deliveries } = build();
    (deliveries.findLatestByMessageId as jest.Mock).mockResolvedValue(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(true as never);

    const resultado = await service.applySendGridEvents([{ event: 'delivered', atlas_message_id: '42', sg_message_id: 'abc.filterdrecv' }]);

    expect(resultado).toEqual({ received: 1, applied: 1 });
    expect(deliveries.findLatestByMessageId).toHaveBeenCalledWith('sendgrid', '42');
    expect(deliveries.findByProviderMessageId).not.toHaveBeenCalled();
  });

  it('SendGrid: sin custom_args cruza por el id del proveedor, sin su decoración', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(true as never);

    await service.applySendGridEvents([{ event: 'bounce', sg_message_id: 'abc123.filterdrecv-1', reason: '550 no existe' }]);

    expect(deliveries.findByProviderMessageId).toHaveBeenCalledWith('sendgrid', 'abc123');
    expect((deliveries.applyOutcome as jest.Mock).mock.calls[0]?.[2]).toBe('550 no existe');
  });

  /**
   * El lote llega mezclado: eventos que no hablan de la entrega, basura y alguno útil. Se procesa
   * entero y se contesta 2xx igual, porque un no-2xx hace que SendGrid reintente el lote COMPLETO,
   * incluidos los eventos ya aplicados.
   */
  it('SendGrid: procesa el lote entero e ignora lo que no es un desenlace', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(entrega as never);
    (deliveries.applyOutcome as jest.Mock).mockResolvedValue(true as never);

    const resultado = await service.applySendGridEvents([
      { event: 'open', sg_message_id: 'a.b' },
      'basura',
      null,
      { event: 'delivered', sg_message_id: 'abc.b' },
    ]);

    expect(resultado).toEqual({ received: 4, applied: 1 });
  });

  it('SendGrid: un evento cuyo mensaje no está en la base no rompe el lote', async () => {
    const { service, deliveries } = build();
    (deliveries.findByProviderMessageId as jest.Mock).mockResolvedValue(null as never);

    expect(await service.applySendGridEvents([{ event: 'delivered', sg_message_id: 'desconocido.b' }])).toEqual({
      received: 1,
      applied: 0,
    });
    expect(deliveries.applyOutcome).not.toHaveBeenCalled();
  });
});
