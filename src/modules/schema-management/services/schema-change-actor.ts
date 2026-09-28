/**
 * @file Utilidad pura: resuelve quién actúa sobre un cambio de esquema y si puede hacerlo.
 * @business Proponer y aprobar un cambio de esquema tiene que poder hacerlo una persona interna con permiso, y nunca la misma persona las dos cosas.
 * @system traduce la sesión (interna o de plataforma) a un actor con población e id, y compara actores para el principio de cuatro ojos.
 */
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import type { SchemaChangeLogRow } from '../schema-management.repository.js';

/**
 * Las dos poblaciones que pueden firmar en el change log. Un id sólo tiene sentido junto a su
 * población: el `_id` 7 de `internal_users` y el 7 de `platform_users` son personas distintas.
 */
export type SchemaChangeActor = { kind: 'internal' | 'platform'; id: string };

/** Roles de sesión con los que un usuario de PLATAFORMA propone o aprueba (regla anterior a A4). */
export const PLATFORM_PROPOSER_ROLES: ReadonlySet<string> = new Set(['internal_operator', 'admin', 'platform_admin']);
export const PLATFORM_APPROVER_ROLES: ReadonlySet<string> = new Set(['platform_admin']);

/**
 * Sesión interna: la autorización ya la decidió el permiso fino (`governance.schema.propose` /
 * `governance.schema.approve`) en `SchemaChangeAuthorizationGuard`; el rol de sesión no cuenta,
 * porque `legacyRoleForInternalRoles` nunca emite `platform_admin` (hallazgo A4).
 *
 * Sesión de plataforma: se mantiene la regla por rol de sesión.
 */
export function resolveSchemaChangeActor(user: AuthenticatedUser, platformRoles: ReadonlySet<string>, action: string): SchemaChangeActor {
  if (user.internalUserId) return { kind: 'internal', id: String(user.internalUserId) };
  if (user.platformUserId) {
    if (!platformRoles.has(user.role)) {
      throw new ForbiddenException(`Role "${user.role}" is not allowed to ${action}. Allowed roles: ${[...platformRoles].join(', ')}.`);
    }
    return { kind: 'platform', id: String(user.platformUserId) };
  }
  throw new ForbiddenException(
    'Schema management actions require an identified internal or platform user (internalUserId/platformUserId missing in token).',
  );
}

/** Quién propuso la fila: el interno si lo hay, si no el de plataforma. */
export function requesterOf(row: SchemaChangeLogRow): SchemaChangeActor | null {
  if (row.requester_internal_user_id) return { kind: 'internal', id: String(row.requester_internal_user_id) };
  if (row.requester_platform_user_id) return { kind: 'platform', id: String(row.requester_platform_user_id) };
  return null;
}

export function sameActor(a: SchemaChangeActor | null, b: SchemaChangeActor): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id;
}

export function describeActor(actor: SchemaChangeActor): string {
  return `${actor.kind}:${actor.id}`;
}
