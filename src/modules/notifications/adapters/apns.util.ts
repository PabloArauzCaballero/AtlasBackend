/**
 * @file Envío a APNs (iPhone), con su firma ES256 y su transporte HTTP/2.
 * @business Esta pieza hace que un aviso llegue también a los iPhone: hasta ahora sólo llegaba a Android.
 * @system firma un JWT ES256 con la llave .p8 de Apple y habla HTTP/2, que es lo único que APNs acepta.
 */
import { connect, constants } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import { base64Url } from '../../../common/utils/crypto/encoding.util.js';

/**
 * Por qué esto no usa `fetch` como el resto de adaptadores.
 *
 * **APNs sólo habla HTTP/2**, y el `fetch` de Node (undici) sólo habla HTTP/1.1: contra
 * `api.push.apple.com` no negocia y la conexión muere sin un error que mencione el protocolo. De ahí
 * `node:http2`, y de ahí que el transporte sea un puerto: así las pruebas ejercitan la firma, las
 * cabeceras y la lectura de la respuesta sin levantar un servidor HTTP/2.
 */
export type ApnsRequest = { token: string; headers: Record<string, string>; body: string };
export type ApnsResponse = { token: string; status: number; body: string };
export type ApnsTransport = (host: string, requests: ApnsRequest[]) => Promise<ApnsResponse[]>;

export const APNS_HOST_PRODUCTION = 'api.push.apple.com';
export const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

/** El JWT de APNs vale una hora; Apple rechaza los de más de 60 min y limita cuántos se piden. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

type SignedToken = { value: string; expiresAt: number };
const tokenCache = new Map<string, SignedToken>();

/** Sólo para pruebas: olvida los JWT ya firmados. */
export function resetApnsTokenCache(): void {
  tokenCache.clear();
}

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/**
 * JWT ES256 con la llave `.p8` de App Store Connect.
 *
 * `dsaEncoding: 'ieee-p1363'` no es un detalle: por omisión Node firma en DER, y JWS exige la
 * concatenación cruda R||S. Con DER, Apple responde 403 `InvalidProviderToken` — un mensaje que manda
 * a revisar la llave cuando lo que está mal es el formato de la firma.
 */
export function signApnsToken(input: { keyId: string; teamId: string; privateKey: string; now?: number }): string {
  const now = input.now ?? Date.now();
  const cacheKey = `${input.teamId}:${input.keyId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: input.keyId }));
  const claim = base64Url(JSON.stringify({ iss: input.teamId, iat: Math.floor(now / 1000) }));
  const unsigned = `${header}.${claim}`;
  const key = createPrivateKey(normalizePrivateKey(input.privateKey));
  const signature = base64Url(sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }));
  const value = `${unsigned}.${signature}`;

  tokenCache.set(cacheKey, { value, expiresAt: now + TOKEN_TTL_MS });
  return value;
}

/** Transporte real: UNA sesión HTTP/2 para todos los dispositivos del mismo mensaje. */
export const http2ApnsTransport: ApnsTransport = async (host, requests) => {
  if (requests.length === 0) return [];
  const session = connect(`https://${host}`);
  try {
    return await Promise.all(requests.map((request) => sendOne(session, request)));
  } finally {
    session.close();
  }
};

function sendOne(session: ReturnType<typeof connect>, request: ApnsRequest): Promise<ApnsResponse> {
  return new Promise<ApnsResponse>((resolve, reject) => {
    const stream = session.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${request.token}`,
      ...request.headers,
    });
    let status = 0;
    let body = '';
    stream.setEncoding('utf8');
    stream.on('response', (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    stream.on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('end', () => resolve({ token: request.token, status, body }));
    stream.on('error', reject);
    stream.end(request.body);
  });
}

export type ApnsCredentials = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  production: boolean;
};

export type ApnsDelivery = {
  ok: boolean;
  /** Tokens que Apple declara muertos (410 `Unregistered`): el dispositivo desinstaló la app. */
  unregistered: string[];
  responses: Record<string, unknown>[];
};

/**
 * Manda el mismo aviso a cada token iOS.
 *
 * Un 410 no es un fallo de entrega ni un error de configuración: es Apple diciendo que ese
 * dispositivo ya no existe. Se devuelve aparte para que quien llama pueda darlo de baja en vez de
 * reintentarlo para siempre.
 */
export async function sendApns(input: {
  credentials: ApnsCredentials;
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
  visible: boolean;
  transport?: ApnsTransport;
  now?: number;
}): Promise<ApnsDelivery> {
  const transport = input.transport ?? http2ApnsTransport;
  const jwt = signApnsToken({ ...input.credentials, now: input.now });
  const host = input.credentials.production ? APNS_HOST_PRODUCTION : APNS_HOST_SANDBOX;

  /*
    `apns-push-type` es obligatorio desde iOS 13 y tiene que coincidir con el cuerpo: `alert` cuando
    hay algo que enseñar y `background` cuando sólo viajan datos. Declarar `alert` sin bloque `aps`
    visible hace que Apple lo acepte y el teléfono no pinte nada — el mismo silencio que costó
    entender el canal de Android.
  */
  const pushType = input.visible ? 'alert' : 'background';
  const payload = {
    aps: input.visible ? { alert: { title: input.title, body: input.body }, sound: 'default' } : { 'content-available': 1 },
    ...input.data,
  };

  const responses = await transport(
    host,
    input.tokens.map((token) => ({
      token,
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': input.credentials.bundleId,
        'apns-push-type': pushType,
        'apns-priority': input.visible ? '10' : '5',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })),
  );

  const unregistered = responses.filter((response) => response.status === 410).map((response) => response.token);
  const failed = responses.filter((response) => response.status !== 200 && response.status !== 410);

  return {
    ok: failed.length === 0,
    unregistered,
    responses: responses.map((response) => ({
      status: response.status,
      reason: readReason(response.body),
      last4: response.token.slice(-4),
    })),
  };
}

/** El motivo que manda Apple (`{"reason":"BadDeviceToken"}`) es lo único accionable de la respuesta. */
function readReason(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    const reason = (parsed as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}
