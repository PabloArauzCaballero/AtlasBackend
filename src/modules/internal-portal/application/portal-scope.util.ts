/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza impide que un operador de un tenant vea u opere sobre la evidencia de otro.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';

/**
 * ATLAS-SEC-009 — alcance por tenant del portal interno.
 *
 * El portal consulta dos tablas que SÍ llevan `_tenant_id` (`system_job_runs`,
 * `data_quality_issues`) y lo hacía sin filtrarlo: un `internal_operator` del tenant A recibía las
 * corridas de job del tenant B —con su `input_json`/`result_json`— y podía reconocer (`acknowledge`)
 * una alerta ajena, escribiendo sobre la fila de otro tenant. Verificado en vivo contra la API real:
 * `docs/audit/evidence/live-exploit-2026-08-06.md`.
 *
 * El resto de tablas del portal (`system_domain_catalog`, `system_data_entity_catalog`,
 * `retention_policies`…) son catálogo de plataforma, iguales para todos los tenants: no llevan
 * `_tenant_id` y no se filtran. Este alcance se aplica **solo** donde la columna existe, que es
 * donde había fuga.
 *
 * Se sigue el precedente ya establecido por systems-ops (`canReadAllSystemsOpsTenants`): la lectura
 * entre tenants queda reservada a los roles de plataforma, no a los roles de tenant.
 */
export type PortalScope = {
  /** Tenant del actor. `null` únicamente para actores de plataforma. */
  readonly tenantId: string | null;
  /** `true` para roles de plataforma, que operan legítimamente sobre todos los tenants. */
  readonly allTenants: boolean;
};

/**
 * Roles cuyo alcance es la PLATAFORMA, no un tenant. Deliberadamente NO incluye `admin`: por el
 * colapso de roles documentado en `systems-ops.constants.ts`, `admin` es el rol legacy que reciben
 * SUPER_ADMIN, SYSTEMS_ADMIN e INTERNAL_IDENTITY_ADMIN — todos ellos administradores *de un tenant*.
 * Darle alcance global reabriría la fuga por la puerta de al lado.
 */
const PLATFORM_WIDE_ROLES: ReadonlySet<string> = new Set(['platform_admin', 'system_admin']);

export function portalScopeFor(user: AuthenticatedUser): PortalScope {
  if (PLATFORM_WIDE_ROLES.has(user.role)) {
    return { tenantId: user.tenantId ?? null, allTenants: true };
  }

  // Un rol de tenant sin `tenantId` en el token no puede acotarse, y servirle datos sin filtro sería
  // exactamente el fallo que este alcance existe para cerrar. Se falla cerrado.
  if (!user.tenantId) {
    throw new ForbiddenException('El token no identifica un tenant: el portal interno no puede acotar la consulta.');
  }

  return { tenantId: user.tenantId, allTenants: false };
}

/**
 * Fragmento SQL de contención por tenant para una tabla con columna `_tenant_id`.
 *
 * Devuelve un predicado siempre verdadero para actores de plataforma y `alias._tenant_id = :scopeTenantId`
 * para el resto. El valor viaja por `replacements` (ver `scopeReplacements`), nunca interpolado.
 */
export function tenantPredicate(scope: PortalScope, alias: string): string {
  return scope.allTenants ? 'TRUE' : `${alias}._tenant_id = CAST(:scopeTenantId AS BIGINT)`;
}

/** Replacements que acompañan a `tenantPredicate`. Vacío cuando el predicado no usa parámetros. */
export function scopeReplacements(scope: PortalScope): Record<string, unknown> {
  return scope.allTenants ? {} : { scopeTenantId: scope.tenantId };
}

/**
 * Contención de las ESCRITURAS y de los `GET /:id`.
 *
 * Un `WHERE _id = :id AND _tenant_id = :scopeTenantId` que no afecta filas es indistinguible de un
 * id inexistente, y eso es justo lo que se quiere: el actor no puede usar el código de respuesta
 * para descubrir qué ids existen en otros tenants.
 */
export function assertRowInScope(scope: PortalScope, rowTenantId: unknown, notFound: () => Error): void {
  if (scope.allTenants) return;
  if (String(rowTenantId ?? '') !== String(scope.tenantId)) throw notFound();
}
