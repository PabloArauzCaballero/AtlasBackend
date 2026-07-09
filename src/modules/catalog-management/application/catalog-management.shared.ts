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
