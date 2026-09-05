import { describe, expect, it } from '@jest/globals';
import { LOCAL_SIGNATURE_QUERY, presignLocalUrl, verifyLocalSignedUrl } from '../../../src/common/files/local-signature.util.js';

/**
 * Firma de los permisos de subida del almacén local.
 *
 * Es el equivalente al prefirmado SigV4 que ya usa la evidencia sobre S3, y existe para que "probar
 * en local" no signifique "probar sin las garantías": la ruta la impone el servidor, el permiso
 * caduca y el tipo y el tamaño van atados a la firma.
 */
const CREDENTIALS = { secret: 'una-clave-de-al-menos-32-caracteres-para-firmar', uploadBaseUrl: 'http://localhost:3005/api/v1/files' };
const NOW = new Date('2026-08-10T12:00:00.000Z');
const HEADERS = { 'content-type': 'image/jpeg', 'content-length': '1024' };
const STORAGE_KEY = '1/42/identity_front/6f1e0f7a-0000-4000-8000-000000000000.jpg';

function presign(overrides: Partial<Parameters<typeof presignLocalUrl>[0]> = {}) {
  return presignLocalUrl({
    credentials: CREDENTIALS,
    method: 'PUT',
    storageKey: STORAGE_KEY,
    expiresInSeconds: 300,
    signedHeaders: HEADERS,
    now: NOW,
    ...overrides,
  });
}

function signatureOf(url: string): string {
  return new URL(url).searchParams.get(LOCAL_SIGNATURE_QUERY.signature) ?? '';
}

describe('presignLocalUrl', () => {
  it('emite una URL con vencimiento, cabeceras firmadas y firma', () => {
    const { url, expiresAt } = presign();
    const params = new URL(url).searchParams;

    expect(params.get(LOCAL_SIGNATURE_QUERY.expires)).toBe(String(Math.floor(NOW.getTime() / 1000) + 300));
    expect(params.get(LOCAL_SIGNATURE_QUERY.signedHeaders)).toBe('content-length;content-type');
    expect(params.get(LOCAL_SIGNATURE_QUERY.signature)).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.toISOString()).toBe('2026-08-10T12:05:00.000Z');
  });

  it('es determinista: la misma entrada produce siempre la misma firma', () => {
    expect(presign().url).toBe(presign().url);
  });

  it('la firma cambia si cambia la clave, el método, el vencimiento o cualquier cabecera firmada', () => {
    const base = signatureOf(presign().url);
    expect(signatureOf(presign({ storageKey: '1/42/identity_front/otro.jpg' }).url)).not.toBe(base);
    expect(signatureOf(presign({ method: 'GET' }).url)).not.toBe(base);
    expect(signatureOf(presign({ expiresInSeconds: 600 }).url)).not.toBe(base);
    // Cambiar el tamaño declarado invalida la firma: es lo que acota el tamaño ANTES de subir.
    expect(signatureOf(presign({ signedHeaders: { ...HEADERS, 'content-length': '2048' } }).url)).not.toBe(base);
    expect(signatureOf(presign({ signedHeaders: { ...HEADERS, 'content-type': 'application/pdf' } }).url)).not.toBe(base);
  });

  it('no depende del orden ni de las mayúsculas con que se declaren las cabeceras', () => {
    const reordered = presign({ signedHeaders: { 'Content-Length': '1024', 'CONTENT-TYPE': 'image/jpeg' } });
    expect(signatureOf(reordered.url)).toBe(signatureOf(presign().url));
  });

  it('un secreto distinto produce una firma distinta', () => {
    const other = presign({ credentials: { ...CREDENTIALS, secret: 'otra-clave-de-al-menos-32-caracteres-distinta' } });
    expect(signatureOf(other.url)).not.toBe(signatureOf(presign().url));
  });
});

describe('verifyLocalSignedUrl', () => {
  function verify(overrides: Partial<Parameters<typeof verifyLocalSignedUrl>[0]> = {}) {
    const { url } = presign();
    const params = new URL(url).searchParams;
    return verifyLocalSignedUrl({
      credentials: CREDENTIALS,
      method: 'PUT',
      storageKey: STORAGE_KEY,
      expiresAtEpoch: Number(params.get(LOCAL_SIGNATURE_QUERY.expires)),
      signature: params.get(LOCAL_SIGNATURE_QUERY.signature) ?? '',
      signedHeaders: HEADERS,
      now: NOW,
      ...overrides,
    });
  }

  it('acepta el permiso que acaba de emitir', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('rechaza un permiso vencido', () => {
    expect(verify({ now: new Date('2026-08-10T12:05:01.000Z') })).toEqual({ ok: false, reason: 'SIGNATURE_EXPIRED' });
  });

  it('rechaza un vencimiento manipulado para extender la vida del permiso', () => {
    const params = new URL(presign().url).searchParams;
    const extended = Number(params.get(LOCAL_SIGNATURE_QUERY.expires)) + 86_400;
    expect(verify({ expiresAtEpoch: extended })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rechaza subir a otra clave, con otro método o con otras cabeceras que las firmadas', () => {
    expect(verify({ storageKey: '1/99/identity_front/robado.jpg' })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify({ method: 'GET' })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify({ signedHeaders: { ...HEADERS, 'content-length': '99999999' } })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rechaza una firma vacía, truncada o de otro secreto sin lanzar', () => {
    expect(verify({ signature: '' })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify({ signature: 'a'.repeat(63) })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify({ credentials: { ...CREDENTIALS, secret: 'otra-clave-distinta-de-32-caracteres-o-mas' } })).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
  });

  it('rechaza un vencimiento no numérico en vez de darlo por válido', () => {
    expect(verify({ expiresAtEpoch: Number.NaN })).toEqual({ ok: false, reason: 'SIGNATURE_EXPIRED' });
  });
});
