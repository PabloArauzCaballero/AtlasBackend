import { describe, expect, it, beforeEach } from '@jest/globals';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  APNS_HOST_PRODUCTION,
  APNS_HOST_SANDBOX,
  ApnsRequest,
  resetApnsTokenCache,
  sendApns,
  signApnsToken,
} from '../../../src/modules/notifications/adapters/apns.util.js';

/**
 * El envío a APNs.
 *
 * Lo que se protege aquí es lo que Apple rechaza en silencio o con un motivo que despista: la firma
 * en formato JWS (no DER), la cabecera `apns-push-type` acorde al cuerpo, el host que corresponde al
 * entorno —un token de sandbox no vale en producción— y que un 410 no se cuente como fallo de envío.
 */
describe('APNs', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const credentials = { keyId: 'KID12345', teamId: 'TEAM99', privateKey, bundleId: 'bo.atlas.consumer', production: true };

  function transporte(respuestas: Array<{ status: number; body?: string }>) {
    const capturado: { host: string; requests: ApnsRequest[] } = { host: '', requests: [] };
    const transport = async (host: string, requests: ApnsRequest[]) => {
      capturado.host = host;
      capturado.requests = requests;
      return requests.map((request, index) => ({
        token: request.token,
        status: respuestas[index]?.status ?? 200,
        body: respuestas[index]?.body ?? '',
      }));
    };
    return { transport, capturado };
  }

  const base = {
    tokens: ['tok-aaaa1111'],
    title: 'Atlas',
    body: 'Tu cuota vence mañana.',
    data: { notificationMessageId: 'm1', channel: 'push' },
    visible: true,
  };

  beforeEach(() => resetApnsTokenCache());

  it('firma en formato JWS (R||S), no DER: con DER Apple responde InvalidProviderToken', () => {
    const jwt = signApnsToken(credentials);
    const [header, claim, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header as string, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KID12345' });
    expect(JSON.parse(Buffer.from(claim as string, 'base64url').toString())).toMatchObject({ iss: 'TEAM99' });
    // 64 bytes exactos es la marca de la concatenación cruda; DER sería de longitud variable.
    const raw = Buffer.from(signature as string, 'base64url');
    expect(raw).toHaveLength(64);

    const verifier = createVerify('sha256');
    verifier.update(`${header}.${claim}`);
    expect(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true);
  });

  it('reutiliza el JWT mientras vale y lo renueva cuando caduca', () => {
    const primero = signApnsToken({ ...credentials, now: 0 });
    expect(signApnsToken({ ...credentials, now: 60_000 })).toBe(primero);
    // Apple rechaza los de más de una hora y limita cuántos se piden.
    expect(signApnsToken({ ...credentials, now: 60 * 60 * 1000 })).not.toBe(primero);
  });

  it('manda el aviso visible con las cabeceras que Apple exige', async () => {
    const { transport, capturado } = transporte([{ status: 200 }]);

    const resultado = await sendApns({ ...base, credentials, transport });

    expect(resultado.ok).toBe(true);
    expect(capturado.host).toBe(APNS_HOST_PRODUCTION);
    const request = capturado.requests[0] as ApnsRequest;
    expect(request.headers['apns-topic']).toBe('bo.atlas.consumer');
    expect(request.headers['apns-push-type']).toBe('alert');
    expect(request.headers['apns-priority']).toBe('10');
    expect(request.headers.authorization).toMatch(/^bearer /);
    expect(JSON.parse(request.body)).toMatchObject({
      aps: { alert: { title: 'Atlas', body: 'Tu cuota vence mañana.' }, sound: 'default' },
      notificationMessageId: 'm1',
    });
  });

  it('sin aviso visible cambia el tipo y el cuerpo, o el teléfono no pinta nada', async () => {
    const { transport, capturado } = transporte([{ status: 200 }]);

    await sendApns({ ...base, visible: false, credentials, transport });

    const request = capturado.requests[0] as ApnsRequest;
    expect(request.headers['apns-push-type']).toBe('background');
    expect(JSON.parse(request.body).aps).toEqual({ 'content-available': 1 });
  });

  it('el entorno decide el host: un token de sandbox no vale en producción', async () => {
    const { transport, capturado } = transporte([{ status: 200 }]);

    await sendApns({ ...base, credentials: { ...credentials, production: false }, transport });

    expect(capturado.host).toBe(APNS_HOST_SANDBOX);
  });

  it('un 410 no es un fallo: es un dispositivo que desinstaló la app', async () => {
    const { transport } = transporte([{ status: 200 }, { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }]);

    const resultado = await sendApns({ ...base, tokens: ['vivo-1234', 'muerto-9876'], credentials, transport });

    expect(resultado.ok).toBe(true);
    expect(resultado.unregistered).toEqual(['muerto-9876']);
  });

  it('un rechazo real sí falla, y conserva el motivo de Apple sin exponer el token', async () => {
    const { transport } = transporte([{ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }]);

    const resultado = await sendApns({ ...base, tokens: ['tok-secreto-1234'], credentials, transport });

    expect(resultado.ok).toBe(false);
    expect(resultado.responses[0]).toEqual({ status: 400, reason: 'BadDeviceToken', last4: '1234' });
    expect(JSON.stringify(resultado.responses)).not.toContain('tok-secreto');
  });
});
