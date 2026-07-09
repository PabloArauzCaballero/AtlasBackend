import jwt, { SignOptions } from 'jsonwebtoken';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../src/config/env.js';
import { AtlasUserRole } from '../../src/common/types/auth.types.js';

export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${env.APP_PORT}/${env.API_PREFIX}`;
export const TENANT_ID = process.env.TENANT_ID ?? '1';
export const CUSTOMER_ID = process.env.CUSTOMER_ID ?? '1';
export const DEVICE_ID = process.env.DEVICE_ID ?? '1';
export const SESSION_ID = process.env.SESSION_ID ?? '1';
export const INTERNAL_USER_ID = process.env.INTERNAL_USER_ID ?? '1';
export const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID ?? '1';

export type SmokeResponse<T = unknown> = {
  status: number;
  data: T;
  text: string;
};

export type SmokeRecordedCall = {
  method: string;
  path: string;
  role: AtlasUserRole | null;
  requestBody: unknown;
  status: number;
  responseData: unknown;
};

const recordedCalls: SmokeRecordedCall[] = [];

export function getRecordedCalls(): SmokeRecordedCall[] {
  return recordedCalls;
}

export function writeSmokeResults(fileName = 'smoke-results.json'): void {
  const outputPath = path.join(__dirname, fileName);
  writeFileSync(outputPath, JSON.stringify(recordedCalls, null, 2), 'utf-8');
  console.log(`[SMOKE] Resultados de DTOs guardados en ${outputPath} (${recordedCalls.length} llamadas)`);
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
    ...(role !== 'customer' ? { internalUserId: overrides.internalUserId ?? INTERNAL_USER_ID } : {}),
    ...(role === 'platform_admin' ? { platformUserId: overrides.platformUserId ?? PLATFORM_USER_ID } : {}),
  };
  const options: SignOptions = { algorithm: 'HS256', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
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
  recordedCalls.push({
    method: input.method,
    path: input.path,
    role: input.role ?? null,
    requestBody: input.body ?? null,
    status: res.status,
    responseData: data,
  });
  const expected = input.expected ?? [200, 201, 202, 204];
  if (!expected.includes(res.status)) {
    throw new Error(`${input.method} ${input.path} expected ${expected.join('/')} got ${res.status}: ${text}`);
  }
  console.log(`[OK] ${input.method} ${input.path} -> ${res.status}`);
  return { status: res.status, data, text };
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

export function getStringFromPaths(value: unknown, paths: string[][]): string {
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
