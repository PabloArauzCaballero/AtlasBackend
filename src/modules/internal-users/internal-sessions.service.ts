/**
 * @file Caso de uso: ver quién del personal tiene sesión abierta y cerrar las de una persona.
 * @business Quien gobierna las cuentas internas tiene que poder saber cuáles están en uso y echar a alguien al instante.
 * @system lee los tokens de refresco vivos y, al cerrar, los revoca y sube `token_version` para matar el access token.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { buildPaginationMeta, PaginationInput, PaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { InternalSessionRow, InternalSessionsRepository } from './internal-sessions.repository.js';
import { RevokeInternalSessionsDto } from './internal-sessions.schemas.js';
import { assertCanAssignRequestedRoles, assertInternalActor } from './internal-users.policy.js';

/**
 * Una sesión cuyo token se renovó dentro de esta ventana se rotula «activa ahora». Es la vida del access
 * token por defecto (`JWT_ACCESS_TOKEN_EXPIRES_IN=1h`): quien usa el portal renueva al menos una vez por
 * ventana, y un token vivo que lleva más sin renovarse suele ser una pestaña cerrada.
 */
export const ACTIVE_NOW_WINDOW_MS = 60 * 60 * 1000;

export type InternalSessionItem = {
  sessionId: string;
  internalUserId: string;
  fullName: string | null;
  email: string | null;
  status: string | null;
  lastLoginAt: string | null;
  renewedAt: string;
  expiresAt: string;
  activeNow: boolean;
  ipAddress: string | null;
  userAgent: string | null;
};

export type InternalSessionsList = {
  items: InternalSessionItem[];
  meta: PaginationMeta;
  summary: { openSessions: number; people: number; activeWindowMinutes: number };
};

const isoOrNull = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null);

function toItem(row: InternalSessionRow, now: Date): InternalSessionItem {
  const renewedAt = new Date(row.renewedAt);
  return {
    sessionId: String(row.sessionId),
    internalUserId: String(row.internalUserId),
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    lastLoginAt: isoOrNull(row.lastLoginAt),
    renewedAt: renewedAt.toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    activeNow: now.getTime() - renewedAt.getTime() <= ACTIVE_NOW_WINDOW_MS,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

@Injectable()
export class InternalSessionsService {
  constructor(
    private readonly sessionsRepository: InternalSessionsRepository,
    private readonly rbacRepository: InternalRbacRepository,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {}

  async listOpenSessions(currentUser: AuthenticatedUser, query: PaginationInput, now: Date = new Date()): Promise<InternalSessionsList> {
    const actor = assertInternalActor(currentUser);
    const pagination = { page: query.page, limit: query.limit };
    const { rows, total, people } = await this.sessionsRepository.listOpenSessions(actor.tenantId, pagination, now);
    return {
      items: rows.map((row) => toItem(row, now)),
      meta: buildPaginationMeta(pagination, total),
      summary: { openSessions: total, people, activeWindowMinutes: ACTIVE_NOW_WINDOW_MS / 60_000 },
    };
  }

  /**
   * Cierra TODAS las sesiones de una persona, con efecto inmediato: revocar sólo los tokens de refresco
   * dejaría vivo el access token ya emitido hasta su vencimiento (1 h), así que además se sube
   * `token_version`, que `JwtAuthGuard` consulta en cada petición.
   *
   * No sobre uno mismo (para eso está «Cerrar sesión», y así nadie se deja fuera por error), y sobre una
   * cuenta con rol privilegiado sólo SUPER_ADMIN, como tocar sus roles o desbloquearla.
   */
  async revokeSessions(
    currentUser: AuthenticatedUser,
    internalUserId: string,
    dto: RevokeInternalSessionsDto,
    requestContext: { ipAddress: string | null; userAgent: string | null },
    now: Date = new Date(),
  ): Promise<{ internalUserId: string; revokedSessions: number }> {
    const actor = assertInternalActor(currentUser);
    const targetUserId = parsePositiveId(internalUserId, 'internalUserId');
    const user = await this.rbacRepository.findUserById(actor.tenantId, targetUserId);
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');
    if (targetUserId === actor.internalUserId) {
      throw new ForbiddenException('No puedes cerrar tus propias sesiones desde aquí: usa «Cerrar sesión».');
    }

    const target = await this.rbacRepository.buildAccessProfile(user);
    await assertCanAssignRequestedRoles(this.rbacRepository, actor, [], target.user.roles);

    const revokedSessions = await this.sessionsRepository.revokeOpenSessions(targetUserId, 'admin_revoked', now);
    await this.tokenRevocationService.bumpTokenVersionIfPresent('internal_user', targetUserId);

    await this.rbacRepository.createAudit({
      tenantId: actor.tenantId,
      actorInternalUserId: actor.internalUserId,
      actionCode: 'internal_users.sessions.revoke',
      targetType: 'internal_user',
      targetId: targetUserId,
      reason: dto.reason,
      metadata: { revokedSessions },
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return { internalUserId: targetUserId, revokedSessions };
  }
}
