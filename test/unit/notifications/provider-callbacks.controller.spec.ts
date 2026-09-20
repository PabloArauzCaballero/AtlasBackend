import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { NotificationProviderCallbacksController } from '../../../src/modules/notifications/notification-provider-callbacks.controller.js';
import { computeTwilioSignature } from '../../../src/modules/notifications/adapters/twilio/twilio-signature.util.js';

/**
 * Estos dos endpoints son `@Public()` respecto al guard de sesión: quien llama es un proveedor, no
 * una persona con token. Lo que los protege es la firma, así que lo que hay que fijar es que SIN
 * secreto configurado o CON firma mala no se toca nada — un webhook de entregas abierto deja que un
 * tercero marque como rebotado el correo de un cliente y lo silencie.
 */
describe('NotificationProviderCallbacksController', () => {
  const authToken = 'token-de-cuenta';
  const url = 'https://api.atlas.test/api/v1/internal/notifications/twilio-status';

  function build(overrides: Record<string, unknown> = {}) {
    // Los parámetros se declaran aunque no se usen: sin ellos TypeScript infiere funciones de cero
    // argumentos y `toHaveBeenCalledWith(...)` deja de compilar.
    const callbacks = {
      applyTwilioStatus: jest.fn(async (_params: Record<string, string>) => ({ applied: true, reason: 'delivered' })),
      applySendGridEvents: jest.fn(async (_events: unknown[]) => ({ received: 1, applied: 1 })),
    };
    const config = {
      getTwilioAuthToken: () => authToken,
      getTwilioStatusCallbackUrl: () => url,
      getSendGridEventPublicKey: () => null,
      ...overrides,
    };
    return { controller: new NotificationProviderCallbacksController(callbacks as never, config as never), callbacks };
  }

  describe('twilio-status', () => {
    const body = { MessageSid: 'SM1', MessageStatus: 'delivered' };

    it('con firma válida aplica el aviso', async () => {
      const { controller, callbacks } = build();
      const firma = computeTwilioSignature(authToken, url, body);
      expect(await controller.twilioStatus(firma, body)).toEqual({ applied: true, reason: 'delivered' });
      expect(callbacks.applyTwilioStatus).toHaveBeenCalledWith(body);
    });

    it('sin callback configurado responde 401 en vez de quedar abierto', async () => {
      const { controller, callbacks } = build({ getTwilioStatusCallbackUrl: () => null });
      await expect(controller.twilioStatus('lo-que-sea', body)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(callbacks.applyTwilioStatus).not.toHaveBeenCalled();

      const sinToken = build({ getTwilioAuthToken: () => null });
      await expect(sinToken.controller.twilioStatus('lo-que-sea', body)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sinToken.callbacks.applyTwilioStatus).not.toHaveBeenCalled();
    });

    it('con firma inválida o ausente no toca nada', async () => {
      const { controller, callbacks } = build();
      await expect(controller.twilioStatus('firma-falsa', body)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.twilioStatus(undefined, body)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(callbacks.applyTwilioStatus).not.toHaveBeenCalled();
    });
  });

  describe('sendgrid-events', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const rawBody = Buffer.from(JSON.stringify([{ event: 'delivered', sg_message_id: 'abc.b' }]), 'utf8');
    const timestamp = String(Math.floor(Date.now() / 1000));

    function firmar(): string {
      const sign = createSign('sha256');
      sign.update(Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]));
      sign.end();
      return sign.sign(privateKey).toString('base64');
    }

    it('con firma válida aplica el lote', async () => {
      const { controller, callbacks } = build({ getSendGridEventPublicKey: () => publicKeyBase64 });
      const peticion = { rawBody } as never;
      expect(await controller.sendGridEvents(peticion, firmar(), timestamp, JSON.parse(rawBody.toString()))).toEqual({
        received: 1,
        applied: 1,
      });
      expect(callbacks.applySendGridEvents).toHaveBeenCalled();
    });

    it('sin llave pública configurada responde 401', async () => {
      const { controller, callbacks } = build({ getSendGridEventPublicKey: () => null });
      await expect(controller.sendGridEvents({ rawBody } as never, firmar(), timestamp, [])).rejects.toBeInstanceOf(UnauthorizedException);
      expect(callbacks.applySendGridEvents).not.toHaveBeenCalled();
    });

    /**
     * Sin cuerpo crudo la firma NO se puede verificar. Se rechaza en vez de aceptar a ciegas: si el
     * parser dejara de conservarlo (un cambio en `main.ts`), el webhook se apagaría de forma
     * ruidosa en vez de volverse un endpoint abierto sin que nadie lo note.
     */
    it('sin cuerpo crudo rechaza en vez de confiar en el JSON parseado', async () => {
      const { controller, callbacks } = build({ getSendGridEventPublicKey: () => publicKeyBase64 });
      await expect(controller.sendGridEvents({} as never, firmar(), timestamp, [])).rejects.toBeInstanceOf(UnauthorizedException);
      expect(callbacks.applySendGridEvents).not.toHaveBeenCalled();
    });

    it('con firma inválida no toca nada', async () => {
      const { controller, callbacks } = build({ getSendGridEventPublicKey: () => publicKeyBase64 });
      await expect(
        controller.sendGridEvents({ rawBody } as never, Buffer.from('falsa').toString('base64'), timestamp, []),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(callbacks.applySendGridEvents).not.toHaveBeenCalled();
    });

    it('un cuerpo que no es una lista se trata como lote vacío, no como error', async () => {
      const { controller, callbacks } = build({ getSendGridEventPublicKey: () => publicKeyBase64 });
      await controller.sendGridEvents({ rawBody } as never, firmar(), timestamp, { no: 'es una lista' });
      expect(callbacks.applySendGridEvents).toHaveBeenCalledWith([]);
    });
  });
});
