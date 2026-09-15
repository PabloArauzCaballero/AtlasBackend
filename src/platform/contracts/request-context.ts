/**
 * @file Contexto técnico mínimo de una petición, validado y sin objetos de transporte (AT-013).
 * @business Un caso de uso necesita saber en nombre de quién actúa y en qué tenant; no necesita el
 *   `Request` de Express ni una entidad de usuario mutable, y jamás debe tomar la identidad de una
 *   cabecera que cualquiera puede escribir.
 * @system Valor inmutable construido SOLO a partir del usuario ya autenticado por los guards. La
 *   cabecera `x-tenant-id` de una petición anónima se conserva como `hintedTenantId`: sirve para
 *   enrutar o agrupar (idempotencia, logs), nunca como autorización.
 */
import type { AtlasUserRole, AuthenticatedUser } from '../../common/types/auth.types.js';

export type Actor = Readonly<{
  type: AtlasUserRole | 'anonymous';
  /** Identificador estable del actor dentro de su tipo; `null` si es anónimo. */
  id: string | null;
  internalUserId: string | null;
}>;

export type RequestContext = Readonly<{
  /** Tenant autorizado por la sesión; `null` cuando no hay usuario autenticado. */
  tenantId: string | null;
  /** Tenant sugerido por cabecera sin verificar. Nunca sustituye a `tenantId`. */
  hintedTenantId: string | null;
  actor: Actor;
  correlationId: string;
  /** Instante de la petición; los casos de uso lo reciben en vez de llamar a `new Date()`. */
  now: Date;
}>;

export type RequestContextSource = {
  user?: AuthenticatedUser;
  correlationId?: string;
  headers?: Record<string, string | string[] | undefined>;
  now?: Date;
};

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function buildRequestContext(source: RequestContextSource): RequestContext {
  const user = source.user;
  const actor: Actor = user
    ? {
        type: user.role,
        id: user.customerId ?? user.internalUserId ?? user.platformUserId ?? user.merchantUserId ?? user.sub,
        internalUserId: user.internalUserId ?? null,
      }
    : { type: 'anonymous', id: null, internalUserId: null };
  return Object.freeze({
    tenantId: user?.tenantId ?? null,
    hintedTenantId: firstHeaderValue(source.headers?.['x-tenant-id']),
    actor: Object.freeze(actor),
    correlationId: source.correlationId ?? 'sin-correlacion',
    now: source.now ?? new Date(),
  });
}

/** El tenant autorizado, o error si la petición no lo tiene: nunca se cae al sugerido por cabecera. */
export function requireTenant(context: RequestContext): string {
  if (!context.tenantId) throw new Error('REQUEST_CONTEXT_WITHOUT_TENANT');
  return context.tenantId;
}
