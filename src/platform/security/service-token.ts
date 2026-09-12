/**
 * @file Identidad de servicio entre contextos (AT-047): un token por llamada, con audiencia del destino.
 * @business Cuando Mensajería pide a Clientes las direcciones de un destinatario, Clientes tiene que saber
 *   QUÉ servicio llama, para QUÉ tenant y con QUÉ permiso; y un token de la API de usuarios no vale para
 *   eso (audiencia distinta), ni el de un servicio vale para otro destino.
 * @system JWT HS256 con secreto compartido (`CONTEXT_SERVICE_TOKEN_SECRET`), `issuer` fijo, `audience`
 *   = contexto destino (`atlas-ctx-<contexto>`), claims `svc` (servicio emisor), `tenantId` y `scopes`.
 *   Vida corta (60 s): se firma por llamada, no se almacena. El tenant viaja en el token, no en cabeceras.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export type ServiceTokenClaims = Readonly<{ service: string; tenantId: string; scopes: readonly string[] }>;

export const SERVICE_TOKEN_TTL_SECONDS = 60;

export function contextAudience(context: string): string {
  return `atlas-ctx-${context}`;
}

export function signServiceToken(input: ServiceTokenClaims & { audienceContext: string; secret?: string; ttlSeconds?: number }): string {
  const secret = input.secret ?? env.CONTEXT_SERVICE_TOKEN_SECRET;
  if (!secret) throw new Error('CONTEXT_SERVICE_TOKEN_SECRET_MISSING');
  return jwt.sign({ svc: input.service, tenantId: input.tenantId, scopes: [...input.scopes] }, secret, {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: contextAudience(input.audienceContext),
    expiresIn: input.ttlSeconds ?? SERVICE_TOKEN_TTL_SECONDS,
    subject: `service:${input.service}`,
  });
}

export type ServiceTokenVerification = Readonly<{ ok: true; claims: ServiceTokenClaims } | { ok: false; reason: string }>;

export function verifyServiceToken(
  token: string,
  expected: { audienceContext: string; scope: string; allowedServices: readonly string[]; secret?: string },
): ServiceTokenVerification {
  const secret = expected.secret ?? env.CONTEXT_SERVICE_TOKEN_SECRET;
  if (!secret) return { ok: false, reason: 'SERVICE_TOKENS_DISABLED' };
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: contextAudience(expected.audienceContext),
    });
    if (typeof decoded === 'string') return { ok: false, reason: 'SERVICE_TOKEN_MALFORMED' };
    payload = decoded;
  } catch (error) {
    return { ok: false, reason: `SERVICE_TOKEN_INVALID: ${error instanceof Error ? error.message : String(error)}` };
  }
  const service = typeof payload.svc === 'string' ? payload.svc : null;
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const scopes = Array.isArray(payload.scopes) ? payload.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
  if (!service || !expected.allowedServices.includes(service)) return { ok: false, reason: 'SERVICE_NOT_ALLOWED' };
  if (!tenantId || !/^\d+$/.test(tenantId)) return { ok: false, reason: 'SERVICE_TOKEN_TENANT_MISSING' };
  if (!scopes.includes(expected.scope)) return { ok: false, reason: 'SERVICE_SCOPE_MISSING' };
  return { ok: true, claims: Object.freeze({ service, tenantId, scopes: Object.freeze(scopes) }) };
}
