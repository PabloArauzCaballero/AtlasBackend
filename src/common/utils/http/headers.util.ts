import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '../../types/auth.types.js';
import { parsePositiveId } from '../ids/id.util.js';

/**
 * Antes de este archivo, `firstHeader`, `userAgentFrom`, `requestMeta`, `requireIdempotencyKey`
 * y `tenantIdFromHeader` vivían copiadas localmente en ~15 controllers/interceptors. Este módulo
 * las consolida sin cambiar su comportamiento.
 *
 * Hay DOS variantes de `firstHeader` a propósito: `firstHeaderValue` retorna `undefined` para
 * headers ausentes (la usan `TenantGuard` y `CurrentTenant`, cuya lógica distingue `undefined`
 * de otros valores), mientras que `firstHeader` normaliza a `null` (la usan el resto de
 * controllers e interceptors). No unificarlas: `TenantGuard` compara contra `undefined` y
 * pasarle `null` cambiaría su semántica.
 */
export type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function firstHeader(value: string | string[] | undefined): string | null {
  return firstHeaderValue(value) ?? null;
}

export function userAgentFrom(request: RequestWithNetwork): string | null {
  return firstHeader(request.headers['user-agent']);
}

export function requestMeta(request: RequestWithNetwork): { ipAddress: string | null; userAgent: string | null } {
  return { ipAddress: request.ip ?? null, userAgent: userAgentFrom(request) };
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value) throw new BadRequestException('X-Idempotency-Key header is required.');
  return value;
}

export function tenantIdFromHeader(value: string | undefined, currentUser?: AuthenticatedUser): string {
  return parsePositiveId(String(value ?? currentUser?.tenantId ?? ''), 'x-tenant-id');
}
