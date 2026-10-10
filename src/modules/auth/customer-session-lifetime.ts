/**
 * @file Tope absoluto de la sesión del cliente: cuándo empezó, cuándo vence y cuánto vive su token de acceso.
 * @business La sesión del cliente dura como mucho `AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS` desde el último inicio de sesión con credenciales, como en la banca.
 * @system funciones puras que usan el emisor de tokens y la rotación de refresh tokens; sólo aplican al actor `customer`.
 */
import { env } from '../../config/env.js';
import type { ActorType } from './auth.repository.js';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Código del 401 de `/auth/refresh` cuando la sesión del cliente pasó su tope absoluto. */
export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';
/** Motivo con el que queda revocado el refresh token de una sesión vencida. */
export const SESSION_EXPIRED_REVOKE_REASON = 'session_expired';

/** Sólo el cliente tiene tope absoluto: portales internos y comercio siguen con su política (no se tocan aquí). */
export function hasAbsoluteSessionCap(actorType: ActorType | string): boolean {
  return actorType === 'customer';
}

/** Instante en que la sesión del cliente deja de poder renovarse. */
export function customerSessionDeadline(sessionStartedAt: Date): Date {
  return new Date(sessionStartedAt.getTime() + env.AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS * HOUR_MS);
}

export function isCustomerSessionExpired(sessionStartedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= customerSessionDeadline(sessionStartedAt).getTime();
}

/**
 * Cuándo empezó la sesión a la que pertenece un refresh token.
 *
 * Los tokens emitidos desde este cambio lo traen (`session_started_at`, que la rotación hereda). Los anteriores
 * los rellenó la migración `20261010120000` con el `issued_at` de la raíz de su cadena de rotación —el inicio de
 * sesión original—. Si aun así llega uno sin dato (emitido por el código viejo entre la migración y el arranque del
 * nuevo), se toma su propia emisión: es lo último que se sabe con certeza y, como mucho, le concede un tope entero
 * más a esa sesión —una sola vez—, en vez de echar a alguien que acaba de entrar.
 */
export function sessionStartOf(token: { sessionStartedAt?: Date | null; issuedAt?: Date | null }, now: Date = new Date()): Date {
  return token.sessionStartedAt ?? token.issuedAt ?? now;
}

/** Vencimiento del refresh token: el de siempre, pero un cliente nunca más allá del tope de su sesión. */
export function refreshTokenExpiry(actorType: ActorType, sessionStartedAt: Date, now: Date = new Date()): Date {
  const standard = new Date(now.getTime() + env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * HOUR_MS);
  if (!hasAbsoluteSessionCap(actorType)) return standard;
  const deadline = customerSessionDeadline(sessionStartedAt);
  return deadline.getTime() < standard.getTime() ? deadline : standard;
}

/**
 * Vida del token de acceso, en segundos, para un actor y una sesión. `null` = la del entorno
 * (`JWT_ACCESS_TOKEN_EXPIRES_IN`), que siguen usando internos y comercio.
 *
 * Al cliente: `AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES` (15 por defecto) y nunca más allá del tope de su sesión, de
 * modo que ni el último token de acceso emitido se pasa de las horas permitidas.
 */
export function accessTokenTtlSeconds(actorType: ActorType, sessionStartedAt: Date | null, now: Date = new Date()): number | null {
  if (!hasAbsoluteSessionCap(actorType)) return null;
  const ttlMs = env.AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES * MINUTE_MS;
  const remainingMs = sessionStartedAt ? customerSessionDeadline(sessionStartedAt).getTime() - now.getTime() : ttlMs;
  return Math.max(1, Math.floor(Math.min(ttlMs, remainingMs) / 1000));
}

/** `expiresIn` de la respuesta, en el mismo formato que el resto (`15m`), o en segundos si lo recortó el tope. */
export function describeTtl(seconds: number | null): string {
  if (seconds === null) return env.JWT_ACCESS_TOKEN_EXPIRES_IN;
  return seconds % 60 === 0 ? `${String(seconds / 60)}m` : `${String(seconds)}s`;
}
