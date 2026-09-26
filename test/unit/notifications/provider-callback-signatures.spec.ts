import { describe, expect, it } from '@jest/globals';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  computeTwilioSignature,
  isValidTwilioSignature,
} from '../../../src/modules/notifications/adapters/twilio/twilio-signature.util.js';
import { isValidSendGridSignature } from '../../../src/modules/notifications/adapters/sendgrid/sendgrid-signature.util.js';

/**
 * La firma es lo ÚNICO que autentica estos dos endpoints: son públicos respecto al guard de sesión
 * porque quien llama es un proveedor, no una persona con token. Un fallo silencioso aquí no se ve
 * —el webhook «funciona»— y deja que cualquiera marque como rebotado el correo de un cliente.
 */
describe('firma de Twilio (X-Twilio-Signature)', () => {
  const authToken = 'token-de-cuenta';
  const url = 'https://api.atlas.test/api/v1/internal/notifications/twilio-status';
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered', To: '+59170000000' };

  it('acepta la firma que Twilio habría calculado', () => {
    const signature = computeTwilioSignature(authToken, url, params);
    expect(isValidTwilioSignature({ authToken, url, params, signature })).toBe(true);
  });

  it('el orden de los parámetros no importa: se ordenan por clave antes de firmar', () => {
    const alReves = { To: params.To, MessageStatus: params.MessageStatus, MessageSid: params.MessageSid };
    expect(computeTwilioSignature(authToken, url, alReves)).toBe(computeTwilioSignature(authToken, url, params));
  });

  it('rechaza un parámetro alterado, otra URL, otro token y la firma ausente', () => {
    const signature = computeTwilioSignature(authToken, url, params);
    expect(isValidTwilioSignature({ authToken, url, params: { ...params, MessageStatus: 'failed' }, signature })).toBe(false);
    expect(isValidTwilioSignature({ authToken, url: `${url}/otro`, params, signature })).toBe(false);
    expect(isValidTwilioSignature({ authToken: 'otro', url, params, signature })).toBe(false);
    expect(isValidTwilioSignature({ authToken, url, params, signature: undefined })).toBe(false);
    expect(isValidTwilioSignature({ authToken, url, params, signature: 'corta' })).toBe(false);
  });
});

describe('firma del Event Webhook de SendGrid', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  function firmar(timestamp: string, rawBody: string): string {
    const sign = createSign('sha256');
    sign.update(Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')]));
    sign.end();
    return sign.sign(privateKey).toString('base64');
  }

  const ahora = 1_800_000_000;
  const rawBody = JSON.stringify([{ event: 'delivered', sg_message_id: 'abc.filterdrecv' }]);

  it('acepta un lote firmado y dentro de la ventana de tiempo', () => {
    const timestamp = String(ahora);
    expect(
      isValidSendGridSignature({
        publicKey: publicKeyBase64,
        signature: firmar(timestamp, rawBody),
        timestamp,
        rawBody,
        nowSeconds: ahora,
      }),
    ).toBe(true);
  });

  /**
   * El cuerpo se verifica CRUDO. Re-serializar el JSON cambia espacios y orden de claves, y la firma
   * deja de cuadrar: es la forma más común de «romper» este webhook sin tocar una línea de firma.
   */
  it('rechaza el mismo contenido re-serializado', () => {
    const timestamp = String(ahora);
    const firma = firmar(timestamp, rawBody);
    const reSerializado = JSON.stringify(JSON.parse(rawBody), null, 2);
    expect(
      isValidSendGridSignature({ publicKey: publicKeyBase64, signature: firma, timestamp, rawBody: reSerializado, nowSeconds: ahora }),
    ).toBe(false);
  });

  it('rechaza un lote viejo aunque su firma sea auténtica (repetición)', () => {
    const timestamp = String(ahora - 3_600);
    expect(
      isValidSendGridSignature({
        publicKey: publicKeyBase64,
        signature: firmar(timestamp, rawBody),
        timestamp,
        rawBody,
        nowSeconds: ahora,
      }),
    ).toBe(false);
  });

  it('rechaza firma ausente, timestamp no numérico, llave inservible y firma de otra clave', () => {
    const timestamp = String(ahora);
    const firma = firmar(timestamp, rawBody);
    const base = { publicKey: publicKeyBase64, timestamp, rawBody, nowSeconds: ahora };
    expect(isValidSendGridSignature({ ...base, signature: undefined })).toBe(false);
    expect(isValidSendGridSignature({ ...base, signature: firma, timestamp: 'ayer' })).toBe(false);
    expect(isValidSendGridSignature({ ...base, signature: firma, publicKey: 'no-es-una-llave' })).toBe(false);
    expect(isValidSendGridSignature({ ...base, signature: Buffer.from('falsa').toString('base64') })).toBe(false);

    const otra = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const firmaAjena = createSign('sha256');
    firmaAjena.update(Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')]));
    firmaAjena.end();
    expect(isValidSendGridSignature({ ...base, signature: firmaAjena.sign(otra.privateKey).toString('base64') })).toBe(false);
  });
});
