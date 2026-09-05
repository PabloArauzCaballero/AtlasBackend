import { execSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jwt, { SignOptions } from 'jsonwebtoken';
import { accessTokenSignOptions } from '../../src/common/utils/auth/jwt-claims.util.js';
import { env } from '../../src/config/env.js';
import { AtlasUserRole } from '../../src/common/types/auth.types.js';
import { redactSensitive } from './redact.js';

export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${env.APP_PORT}/${env.API_PREFIX}`;
export const TENANT_ID = process.env.TENANT_ID ?? '1';
export const CUSTOMER_ID = process.env.CUSTOMER_ID ?? '1';
export const DEVICE_ID = process.env.DEVICE_ID ?? '1';
export const SESSION_ID = process.env.SESSION_ID ?? '1';
export const INTERNAL_USER_ID = process.env.INTERNAL_USER_ID ?? '1';
export const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID ?? '1';
export const MERCHANT_USER_ID = process.env.MERCHANT_USER_ID ?? '1';

export type SmokeResponse<T = unknown> = {
  status: number;
  data: T;
  text: string;
  /**
   * Cabeceras `Set-Cookie` de la respuesta.
   *
   * El login del portal interno (`POST /internal/auth/login`) NO devuelve el token en el cuerpo:
   * responde `tokenType: 'Cookie'` y lo entrega en una cookie `HttpOnly`, precisamente para que un
   * XSS en el portal no pueda leerlo. Un smoke que solo mire el cuerpo no encuentra el token y
   * falla con un mensaje confuso sobre un campo ausente, en vez de con el motivo real.
   */
  setCookie: string[];
};

export type SmokeRecordedCall = {
  method: string;
  path: string;
  role: AtlasUserRole | null;
  requestBody: unknown;
  status: number;
  responseData: unknown;
  ok: boolean;
};

const recordedCalls: SmokeRecordedCall[] = [];

export function getRecordedCalls(): SmokeRecordedCall[] {
  return recordedCalls;
}

/**
 * ATLAS-P0-SMOKE-001: los resultados de smoke se siguen generando siempre — solo se movieron a una
 * carpeta dedicada (fuera del índice de Git, ver `.gitignore`), con un contrato de esquema estable
 * y redacción de secretos, y con escritura atómica (`.tmp` + rename) para que un fallo a mitad de
 * escritura nunca deje un JSON corrupto o truncado como "resultado válido".
 */
const RESULTS_DIR = path.join(__dirname, 'results');

function currentCommitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..', '..') })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export function writeSmokeResults(suite = 'all', fileName = 'smoke-results.json'): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outputPath = path.join(RESULTS_DIR, fileName);
  const tmpPath = `${outputPath}.tmp`;

  const passed = recordedCalls.filter((call) => call.ok).length;
  const result = {
    schemaVersion: '1.0.0',
    suite,
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitSha(),
    environment: env.NODE_ENV,
    summary: { total: recordedCalls.length, passed, failed: recordedCalls.length - passed },
    calls: recordedCalls.map((call) => ({
      ...call,
      requestBody: redactSensitive(call.requestBody),
      responseData: redactSensitive(call.responseData),
    })),
  };

  const serialized = JSON.stringify(result, null, 2);
  writeFileSync(tmpPath, serialized, 'utf-8');
  renameSync(tmpPath, outputPath);
  console.log(`[SMOKE] Resultados guardados en ${outputPath} (${recordedCalls.length} llamadas, ${passed} ok)`);
}

export function logSmokeConfig(): void {
  console.log(
    '[SMOKE CONFIG]',
    JSON.stringify({ BASE_URL, TENANT_ID, CUSTOMER_ID, DEVICE_ID, SESSION_ID, INTERNAL_USER_ID, PLATFORM_USER_ID }),
  );
}

export function token(role: AtlasUserRole, overrides: Record<string, string> = {}): string {
  const payload = {
    sub: overrides.sub ?? `${role}-smoke`,
    role,
    tenantId: overrides.tenantId ?? TENANT_ID,
    ...(role === 'customer' ? { customerId: overrides.customerId ?? CUSTOMER_ID } : {}),
    /*
     * El comercio es una población PROPIA, y esto no la contemplaba.
     *
     * `merchant` caía en la rama de «todo lo que no es cliente» y salía con `internalUserId`, que
     * es de otra población, y SIN `merchantUserId`. Con ese token el onboarding de comercios abría
     * expedientes sin dueño —el emisor real deriva el dueño de ese claim— y luego no podía leerlos:
     * `assertOwnPartnerResource` los trata como internos, que es justo lo que protege el histórico.
     * El smoke fallaba con un 403 correcto contra un backend sano.
     */
    ...(role === 'merchant' ? { merchantUserId: overrides.merchantUserId ?? MERCHANT_USER_ID } : {}),
    ...(role !== 'customer' && role !== 'merchant' ? { internalUserId: overrides.internalUserId ?? INTERNAL_USER_ID } : {}),
    ...(role === 'platform_admin' ? { platformUserId: overrides.platformUserId ?? PLATFORM_USER_ID } : {}),
  };
  const options: SignOptions = accessTokenSignOptions({
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
  });
  return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request<T = unknown>(input: {
  method: string;
  path: string;
  role?: AtlasUserRole;
  body?: unknown;
  idempotencyKey?: string;
  expected?: number[];
  extraHeaders?: Record<string, string>;
}): Promise<SmokeResponse<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-tenant-id': TENANT_ID,
    'x-request-id': `smoke-${Date.now()}`,
    ...input.extraHeaders,
  };
  if (input.role) headers.authorization = `Bearer ${token(input.role)}`;
  if (input.idempotencyKey) headers['x-idempotency-key'] = input.idempotencyKey;

  const url = `${BASE_URL}${input.path}`;
  const res = await fetch(url, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await res.text();
  const data = parseBody(text) as T;
  const expected = input.expected ?? [200, 201, 202, 204];
  const ok = expected.includes(res.status);
  recordedCalls.push({
    method: input.method,
    path: input.path,
    role: input.role ?? null,
    requestBody: input.body ?? null,
    status: res.status,
    responseData: data,
    ok,
  });
  if (!ok) {
    throw new Error(`${input.method} ${input.path} expected ${expected.join('/')} got ${res.status}: ${text}`);
  }
  console.log(`[OK] ${input.method} ${input.path} -> ${res.status}`);
  return { status: res.status, data, text, setCookie: res.headers.getSetCookie() };
}

/**
 * Extrae el valor de una cookie de las cabeceras `Set-Cookie` de una respuesta. Devuelve `null` si
 * la cookie no viene, para que quien llama decida si eso es un fallo o un caso legítimo.
 */
export function cookieValue(setCookie: readonly string[], name: string): string | null {
  for (const entry of setCookie) {
    const match = entry.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getString(value: unknown, path: string[], fallback?: string): string {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`No se encontró ${path.join('.')} en la respuesta smoke: ${JSON.stringify(value)}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string') return current;
  if (fallback !== undefined) return fallback;
  throw new Error(`${path.join('.')} no es string/number en la respuesta smoke: ${JSON.stringify(value)}`);
}

function getValueFromPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      throw new Error(`No se encontró ${path.join('.')} en la respuesta smoke: ${JSON.stringify(value)}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * El login interno ya no devuelve un token: devuelve un DESAFÍO.
 *
 * Desde que el segundo factor es obligatorio para `internal_user` y `platform_user`, un login con
 * el canal de correo configurado responde `pinChallengeRequired: true` y un `challengeToken` que
 * hay que canjear con el PIN entregado por correo. Ningún smoke lo canjea —el código va cifrado a
 * un buzón—, así que los cuatro que autentican como actor interno se quedan sin `accessToken`.
 *
 * Sin esta comprobación el fallo salía como «no se encontró accessToken», que manda a buscar un
 * campo ausente en vez de explicar que la política de autenticación cambió y cómo correr el smoke.
 * La salida que el propio servicio documenta para entornos de prueba es `AUTH_LOGIN_PIN_ENABLED=false`.
 */
function assertNotPinChallenge(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const data = (value as { data?: unknown }).data;
  const body = (typeof data === 'object' && data !== null ? data : value) as {
    pinChallengeRequired?: unknown;
  };
  if (body.pinChallengeRequired !== true) return;
  throw new Error(
    'El login interno devolvió un DESAFÍO de segundo factor, no un token: los actores internos ' +
      '(admin, platform_admin) tienen 2FA obligatorio cuando hay canal de correo configurado, y ' +
      'este smoke no puede canjear un PIN que se entrega por correo.\n' +
      'Levanta la API con AUTH_LOGIN_PIN_ENABLED=false para correr los smokes que autentican como ' +
      'actor interno (es la salida que el propio AuthSecondFactorService documenta para entornos ' +
      'de prueba; en producción el env schema la prohíbe).',
  );
}

export function getStringFromPaths(value: unknown, paths: string[][]): string {
  assertNotPinChallenge(value);
  const errors: string[] = [];
  for (const path of paths) {
    try {
      const current = getValueFromPath(value, path);
      if (typeof current === 'number') return String(current);
      if (typeof current === 'string') return current;
      throw new Error(`${path.join('.')} no es string/number en la respuesta smoke: ${JSON.stringify(value)}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `No se encontró string/number en ninguna ruta smoke (${paths.map((path) => path.join('.')).join(' | ')}): ${JSON.stringify(value)}. Errores: ${errors.join(' ; ')}`,
  );
}

export function getArrayFromPaths<T = Record<string, unknown>>(value: unknown, paths: string[][]): T[] {
  const errors: string[] = [];
  for (const path of paths) {
    try {
      const current = getValueFromPath(value, path);
      if (Array.isArray(current)) return current as T[];
      throw new Error(`${path.join('.')} no es array en la respuesta smoke: ${JSON.stringify(value)}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `No se encontró array en ninguna ruta smoke (${paths.map((path) => path.join('.')).join(' | ')}): ${JSON.stringify(value)}. Errores: ${errors.join(' ; ')}`,
  );
}
