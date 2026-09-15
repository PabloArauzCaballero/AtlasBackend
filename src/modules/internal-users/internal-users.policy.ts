/**
 * @file Reglas de autorización del alta y la asignación de roles internos.
 * @business Decide quién puede tocar un rol privilegiado y qué sesiones cuentan como usuario interno.
 * @system Funciones puras sobre `InternalRbacRepository`; sin estado ni dependencias de Nest.
 */
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { INTERNAL_ROLE_CODES } from './internal-rbac.seed-data.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';

export const roleCodeSet = new Set<string>(INTERNAL_ROLE_CODES);
export const privilegedRoleCodes = new Set(['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'INTERNAL_IDENTITY_ADMIN']);
export const disabledLikeStatuses = new Set(['suspended', 'locked', 'disabled']);

export function assertInternalActor(user: AuthenticatedUser): { tenantId: string; internalUserId: string } {
  if (!user.tenantId || !user.internalUserId) {
    throw new ForbiddenException('Esta operación requiere una sesión de usuario interno.');
  }

  return { tenantId: parsePositiveId(user.tenantId, 'tenantId'), internalUserId: parsePositiveId(user.internalUserId, 'internalUserId') };
}

export function uniqueRoleCodes(roleCodes: readonly string[]): string[] {
  return [...new Set(roleCodes)].filter((roleCode) => roleCodeSet.has(roleCode));
}

async function getActorRoleCodes(rbacRepository: InternalRbacRepository, tenantId: string, internalUserId: string): Promise<string[]> {
  const actorUser = await rbacRepository.findUserById(tenantId, internalUserId);
  if (!actorUser || actorUser.status !== 'active') {
    throw new ForbiddenException('El usuario interno actual ya no está activo.');
  }

  return (await rbacRepository.buildAccessProfile(actorUser)).user.roles;
}

/**
 * Exige SUPER_ADMIN cuando la operación TOCA un rol privilegiado — ya sea porque se está
 * asignando (`roleCodes`) o porque el usuario objetivo ya lo tenía y `replaceRoles` lo va a
 * quitar (`currentRoleCodes`, vacío en creación de usuario nuevo). Antes solo se miraba
 * `roleCodes`: un actor con `internal.users.manage` + `internal.roles.manage` pero SIN
 * SUPER_ADMIN (p. ej. el rol `INTERNAL_IDENTITY_ADMIN`) podía llamar a `replaceRoles` con una
 * lista de roles no privilegiados sobre un usuario que sí tenía SUPER_ADMIN/SYSTEMS_ADMIN, y el
 * chequeo se saltaba por completo porque la lista NUEVA no "asignaba" ningún rol crítico —
 * despojando en silencio el rol privilegiado del objetivo sin nunca haber tenido que probar ser
 * SUPER_ADMIN. Con `currentRoleCodes` en el chequeo, quitar un rol privilegiado exige lo mismo
 * que asignarlo.
 */
export async function assertCanAssignRequestedRoles(
  rbacRepository: InternalRbacRepository,
  actor: { tenantId: string; internalUserId: string },
  roleCodes: readonly string[],
  currentRoleCodes: readonly string[] = [],
): Promise<void> {
  const touchesPrivilegedRole =
    roleCodes.some((roleCode) => privilegedRoleCodes.has(roleCode)) ||
    currentRoleCodes.some((roleCode) => privilegedRoleCodes.has(roleCode));
  if (!touchesPrivilegedRole) return;

  const actorRoleCodes = await getActorRoleCodes(rbacRepository, actor.tenantId, actor.internalUserId);
  if (!actorRoleCodes.includes('SUPER_ADMIN')) {
    throw new ForbiddenException('Solo SUPER_ADMIN puede asignar o quitar roles administrativos críticos.');
  }
}
