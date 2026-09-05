/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system firma y verifica permisos de subida de vida corta para el almacén local.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Equivalente local del prefirmado SigV4 que ya usa el almacén de evidencia.
 *
 * El objetivo es que el almacén local NO sea una versión relajada del de producción: la ruta la
 * impone el servidor, el permiso caduca, y el tipo y el tamaño van FIRMADOS, de modo que un cliente
 * no puede subir 2 GB con un ticket emitido para 200 KB ni cambiar el `Content-Type` a conveniencia.
 *
 * Se implementa con `node:crypto` —como la firma SigV4 y el cliente clamd del repositorio— en vez de
 * incorporar una librería: es un HMAC sobre una cadena canónica.
 */
export type LocalSignatureCredentials = {
  secret: string;
  /** Base pública del endpoint que recibirá el PUT, p.ej. `http://localhost:3005/api/v1/files`. */
  uploadBaseUrl: string;
};

export const LOCAL_SIGNATURE_QUERY = {
  expires: 'X-Atlas-Expires',
  signedHeaders: 'X-Atlas-SignedHeaders',
  signature: 'X-Atlas-Signature',
} as const;

export type LocalSignatureInput = {
  credentials: LocalSignatureCredentials;
  method: 'PUT' | 'GET';
  storageKey: string;
  expiresInSeconds: number;
  /** Cabeceras que quedan atadas a la firma. Alterarlas invalida la URL. */
  signedHeaders?: Record<string, string>;
  now: Date;
};

/**
 * Cadena canónica: cualquier diferencia en método, clave, vencimiento o cabeceras firmadas produce
 * una firma distinta. Los nombres de cabecera se normalizan a minúsculas y se ordenan para que la
 * misma intención produzca siempre la misma firma.
 */
function canonicalString(method: string, storageKey: string, expiresAtEpoch: number, signedHeaders: Record<string, string>): string {
  const headers = Object.entries(signedHeaders)
    .map(([name, value]) => [name.toLowerCase().trim(), value.trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}:${value}`)
    .join('\n');
  return [method, storageKey, String(expiresAtEpoch), headers].join('\n');
}

function sign(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function signedHeaderNames(signedHeaders: Record<string, string>): string {
  return Object.keys(signedHeaders)
    .map((name) => name.toLowerCase().trim())
    .sort()
    .join(';');
}

/** Devuelve la URL firmada y el instante exacto en que deja de ser válida. */
export function presignLocalUrl(input: LocalSignatureInput): { url: string; expiresAt: Date } {
  const signedHeaders = input.signedHeaders ?? {};
  const expiresAt = new Date(input.now.getTime() + input.expiresInSeconds * 1000);
  const expiresAtEpoch = Math.floor(expiresAt.getTime() / 1000);

  const signature = sign(input.credentials.secret, canonicalString(input.method, input.storageKey, expiresAtEpoch, signedHeaders));

  const base = input.credentials.uploadBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/${input.storageKey.split('/').map(encodeURIComponent).join('/')}`);
  url.searchParams.set(LOCAL_SIGNATURE_QUERY.expires, String(expiresAtEpoch));
  url.searchParams.set(LOCAL_SIGNATURE_QUERY.signedHeaders, signedHeaderNames(signedHeaders));
  url.searchParams.set(LOCAL_SIGNATURE_QUERY.signature, signature);

  return { url: url.toString(), expiresAt };
}

export type LocalSignatureVerdict = { ok: true } | { ok: false; reason: 'SIGNATURE_EXPIRED' | 'SIGNATURE_INVALID' };

/**
 * Verifica un permiso presentado por el cliente.
 *
 * El vencimiento se comprueba ANTES que la firma para no hacer trabajo criptográfico por una URL ya
 * muerta, y la comparación final es de tiempo constante: comparar hashes con `===` filtra, byte a
 * byte, cuánto acertó quien lo intenta.
 */
export function verifyLocalSignedUrl(input: {
  credentials: LocalSignatureCredentials;
  method: 'PUT' | 'GET';
  storageKey: string;
  expiresAtEpoch: number;
  signature: string;
  signedHeaders?: Record<string, string>;
  now: Date;
}): LocalSignatureVerdict {
  if (!Number.isFinite(input.expiresAtEpoch) || input.expiresAtEpoch * 1000 <= input.now.getTime()) {
    return { ok: false, reason: 'SIGNATURE_EXPIRED' };
  }

  const expected = sign(
    input.credentials.secret,
    canonicalString(input.method, input.storageKey, input.expiresAtEpoch, input.signedHeaders ?? {}),
  );

  const provided = Buffer.from(input.signature, 'utf8');
  const reference = Buffer.from(expected, 'utf8');
  if (provided.length !== reference.length || !timingSafeEqual(provided, reference)) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  return { ok: true };
}
