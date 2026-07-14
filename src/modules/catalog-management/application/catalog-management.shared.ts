import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { isInternalOrSystemRole } from '../../../common/utils/auth/role-groups.util.js';

export type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

export function assertInternal(user: AuthenticatedUser): void {
  if (!isInternalOrSystemRole(user.role)) throw new ForbiddenException('Este endpoint es interno.');
}

/**
 * Defensa en profundidad para decisiones de aprobación (versión de catálogo, activación de
 * ruleset de riesgo): el `@Roles` del controlador es la primera barrera, pero al igual que
 * `AuthService.provisionCredentials`, el chequeo no debe vivir solo en el decorador.
 */
export function assertAdmin(user: AuthenticatedUser): void {
  if (user.role !== 'admin' && user.role !== 'platform_admin') {
    throw new ForbiddenException('Solo un administrador puede aprobar, rechazar o activar esta solicitud de cambio.');
  }
}

export function requireIdempotency(context: RequestContext): void {
  if (!context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
}

export function actorPlatformUserId(user: AuthenticatedUser): string | null {
  return user.platformUserId ?? null;
}

export function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function auditBase(context: RequestContext, user: AuthenticatedUser) {
  return {
    tenantId: context.tenantId,
    actorType: user.role,
    actorInternalUserId: user.internalUserId ?? null,
    actorPlatformUserId: actorPlatformUserId(user),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
