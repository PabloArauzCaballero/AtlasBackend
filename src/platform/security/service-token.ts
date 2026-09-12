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
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

export type ServiceTokenClaims = Readonly<{
  service: string;
  tenantId: string;
  scopes: readonly string[];
  resource: string | null;
  jti: string | null;
}>;

/**
 * Huella del recurso concreto al que da acceso el token. Revisión independiente A, hallazgo 7: un token
 * que sólo dice «servicio + tenant + scope» permite, si se captura, enumerar CUALQUIER cliente de ese
 * tenant contra un endpoint que devuelve contactos en claro. Con la huella dentro, el token sólo sirve
 * para la consulta que se firmó.
 */
export function resourceFingerprint(parts: Readonly<Record<string, string>>): string {
  return Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key]}`)
    .join('&');
}

export const SERVICE_TOKEN_TTL_SECONDS = 60;

export function contextAudience(context: string): string {
  return `atlas-ctx-${context}`;
}

export function signServiceToken(
  input: Omit<ServiceTokenClaims, 'resource' | 'jti'> & {
    audienceContext: string;
    /** Huella del recurso concreto (`resourceFingerprint`); el verificador la exige si la ruta la declara. */
    resource?: string | null;
    secret?: string;
    ttlSeconds?: number;
  },
): string {
  const secret = input.secret ?? env.CONTEXT_SERVICE_TOKEN_SECRET;
  if (!secret) throw new Error('CONTEXT_SERVICE_TOKEN_SECRET_MISSING');
  return jwt.sign(
    { svc: input.service, tenantId: input.tenantId, scopes: [...input.scopes], res: input.resource ?? null, jti: randomUUID() },
    secret,
    {
      algorithm: 'HS256',
      issuer: env.JWT_ISSUER,
      audience: contextAudience(input.audienceContext),
      expiresIn: input.ttlSeconds ?? SERVICE_TOKEN_TTL_SECONDS,
      subject: `service:${input.service}`,
    },
  );
}

export type ServiceTokenVerification = Readonly<{ ok: true; claims: ServiceTokenClaims } | { ok: false; reason: string }>;

export function verifyServiceToken(
  token: string,
  expected: { audienceContext: string; scope: string; allowedServices: readonly string[]; secret?: string; resource?: string },
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
  return checkClaims(payload, expected);
}

/** Comprobación de los claims ya verificados criptográficamente: servicio, tenant, permiso y recurso. */
function checkClaims(
  payload: jwt.JwtPayload,
  expected: { scope: string; allowedServices: readonly string[]; resource?: string },
): ServiceTokenVerification {
  const service = typeof payload.svc === 'string' ? payload.svc : null;
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const scopes = Array.isArray(payload.scopes) ? payload.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
  const resource = typeof payload.res === 'string' ? payload.res : null;
  if (!service || !expected.allowedServices.includes(service)) return { ok: false, reason: 'SERVICE_NOT_ALLOWED' };
  if (!tenantId || !/^\d+$/.test(tenantId)) return { ok: false, reason: 'SERVICE_TOKEN_TENANT_MISSING' };
  if (!scopes.includes(expected.scope)) return { ok: false, reason: 'SERVICE_SCOPE_MISSING' };
  // El recurso se exige cuando la ruta lo declara: un token firmado para otro cliente o propósito no vale.
  if (expected.resource !== undefined && resource !== expected.resource) return { ok: false, reason: 'SERVICE_RESOURCE_MISMATCH' };
  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  return { ok: true, claims: Object.freeze({ service, tenantId, scopes: Object.freeze(scopes), resource, jti }) };
}
