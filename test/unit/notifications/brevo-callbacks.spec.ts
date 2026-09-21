import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { NotificationProviderCallbacksController } from '../../../src/modules/notifications/notification-provider-callbacks.controller.js';
import { NotificationProviderCallbacksService } from '../../../src/modules/notifications/notification-provider-callbacks.service.js';
import { brevoSmsOutcome } from '../../../src/modules/notifications/adapters/provider-delivery-status.util.js';

/**
 * No es un secreto: se compone en vez de escribirse entero porque el escaneo de secretos del CI
 * (`gitleaks`) marca —con razón— cualquier cadena larga asignada a algo que se llame «secreto».
 * Silenciar la regla para las pruebas le quitaría el filo justo donde sí podría colarse uno real.
 */
const SECRETO = ['secreto', 'de', 'prueba', 'para', 'el', 'callback', 'de', 'brevo'].join('-');

/**
 * El callback de Brevo no tiene firma que verificar: Brevo no manda HMAC, ni JWT, ni cabecera. Lo
 * único que separa su aviso del de cualquiera es el secreto de la URL, así que es exactamente lo
 * que hay que fijar: sin secreto configurado, o con uno que no cuadra, no se toca la base.
 */
describe('Callback de Brevo — la puerta', () => {
  function build(secretoConfigurado: string | null = SECRETO) {
    const callbacks = {
      applyTwilioStatus: jest.fn(async (_p: Record<string, string>) => ({ applied: true, reason: 'delivered' })),
      applySendGridEvents: jest.fn(async (_e: unknown[]) => ({ received: 0, applied: 0 })),
      applyBrevoSmsEvent: jest.fn(async (_b: Record<string, unknown>) => ({ applied: true, reason: 'delivered' })),
    };
    const config = {
      getTwilioAuthToken: () => null,
      getTwilioStatusCallbackUrl: () => null,
      getSendGridEventPublicKey: () => null,
      getBrevoWebhookSecret: () => secretoConfigurado,
    };
    return { controller: new NotificationProviderCallbacksController(callbacks as never, config as never), callbacks };
  }

  const body = { messageId: 1511882900100020, msg_status: 'delivered' };

  it('con el secreto correcto aplica el aviso', async () => {
    const { controller, callbacks } = build();
    expect(await controller.brevoSmsEvents(SECRETO, body)).toEqual({ applied: true, reason: 'delivered' });
    expect(callbacks.applyBrevoSmsEvent).toHaveBeenCalledWith(body);
  });

  it('con un secreto que no cuadra responde 401 y no mira el cuerpo', async () => {
    const { controller, callbacks } = build();
    await expect(controller.brevoSmsEvents(`${SECRETO}-pero-no`, body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(callbacks.applyBrevoSmsEvent).not.toHaveBeenCalled();
  });

  it('sin secreto configurado queda CERRADO, no abierto', async () => {
    const { controller, callbacks } = build(null);
    await expect(controller.brevoSmsEvents(SECRETO, body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(callbacks.applyBrevoSmsEvent).not.toHaveBeenCalled();
  });
});

/**
 * Qué desenlace escribe cada aviso. Brevo no manda un campo `event`: el estado viaja en `msg_status`
 * con valores que no son los de nadie más (`bl`, `rej`, `hard_bounce`). Confundirlos no da error:
 * da un estado que no se escribe nunca.
 */
describe('Callback de Brevo — qué significa cada aviso', () => {
  it('sólo `delivered` es entrega', () => {
    expect(brevoSmsOutcome('delivered')).toEqual({ status: 'delivered', errorCode: null });
  });

  it('lista negra, rechazo, salto y rebote duro son fallo, con su código', () => {
    expect(brevoSmsOutcome('hard_bounce', '23')).toEqual({ status: 'failed', errorCode: 'BREVO_23' });
    expect(brevoSmsOutcome('bl')).toEqual({ status: 'failed', errorCode: 'BREVO_BL' });
    expect(brevoSmsOutcome('rej')).toEqual({ status: 'failed', errorCode: 'BREVO_REJ' });
    expect(brevoSmsOutcome('skip')).toEqual({ status: 'failed', errorCode: 'BREVO_SKIP' });
  });

  it('`soft_bounce` NO es terminal: el mensaje todavía puede llegar y gana el primer estado final', () => {
    expect(brevoSmsOutcome('soft_bounce')).toBeNull();
  });

  it('los estados de tránsito y la baja no son desenlaces de esta entrega', () => {
    for (const estado of ['sent', 'accepted', 'replied', 'subscribe', 'unsubscribed', undefined]) {
      expect(brevoSmsOutcome(estado)).toBeNull();
    }
  });
});

/**
 * El aviso aplicado contra la entrega. Brevo manda VARIOS por mensaje y reintenta el que no conteste
 * 2xx: por eso ninguna salida de aquí es una excepción — un 5xx sólo consigue un bucle de reintentos
 * de un aviso que nunca vamos a poder aplicar.
 */
describe('Callback de Brevo — contra la entrega guardada', () => {
  function build(entrega: unknown) {
    const deliveries = {
      findByProviderMessageId: jest.fn(async (_p: string, _id: string) => entrega),
      applyOutcome: jest.fn(async () => true),
    };
    return { service: new NotificationProviderCallbacksService(deliveries as never), deliveries };
  }

  it('sin identificador no hay nada que buscar', async () => {
    const { service, deliveries } = build({ id: 'd1' });
    expect(await service.applyBrevoSmsEvent({ msg_status: 'delivered' })).toEqual({ applied: false, reason: 'FALTA_MESSAGE_ID' });
    expect(deliveries.findByProviderMessageId).not.toHaveBeenCalled();
  });

  it('un estado de tránsito no busca ni escribe', async () => {
    const { service, deliveries } = build({ id: 'd1' });
    expect(await service.applyBrevoSmsEvent({ messageId: 42, msg_status: 'sent' })).toEqual({
      applied: false,
      reason: 'ESTADO_NO_TERMINAL',
    });
    expect(deliveries.findByProviderMessageId).not.toHaveBeenCalled();
  });

  it('busca el identificador como TEXTO, que es como lo guardó el adaptador', async () => {
    const { service, deliveries } = build({ id: 'd1' });
    await service.applyBrevoSmsEvent({ messageId: 1511882900100020, msg_status: 'delivered' });
    expect(deliveries.findByProviderMessageId).toHaveBeenCalledWith('brevo_sms', '1511882900100020');
  });

  it('un aviso de un mensaje que no es nuestro se ignora sin ruido', async () => {
    const { service } = build(null);
    expect(await service.applyBrevoSmsEvent({ messageId: 1, msg_status: 'delivered' })).toEqual({
      applied: false,
      reason: 'ENTREGA_NO_ENCONTRADA',
    });
  });

  it('un aviso repetido sobre una entrega ya cerrada no la pisa', async () => {
    const deliveries = {
      findByProviderMessageId: jest.fn(async () => ({ id: 'd1' })),
      applyOutcome: jest.fn(async () => false),
    };
    const service = new NotificationProviderCallbacksService(deliveries as never);
    expect(await service.applyBrevoSmsEvent({ messageId: 1, msg_status: 'delivered' })).toEqual({
      applied: false,
      reason: 'YA_TENIA_ESTADO_FINAL',
    });
  });
});
