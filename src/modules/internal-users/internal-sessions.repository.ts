/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system lee los tokens de refresco vivos del personal y los revoca de una vez.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { PaginationInput, toOffset } from '../../common/utils/pagination/pagination.util.js';

export type InternalSessionRow = {
  sessionId: string;
  internalUserId: string;
  fullName: string | null;
  email: string | null;
  status: string | null;
  lastLoginAt: Date | null;
  renewedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * Una sesión abierta es un token de refresco de `internal_user` sin revocar y sin vencer. Cada renovación
 * revoca el anterior y emite uno nuevo (`replaced_by_token_id`), así que hay UNA fila viva por sesión y su
 * `issued_at` es la última vez que esa sesión se renovó, no la del primer login.
 *
 * El tenant sale del usuario y no del token: `auth_refresh_tokens._tenant_id` admite nulos.
 */
const OPEN_SESSIONS_FROM = `
  FROM auth_refresh_tokens t
  JOIN internal_users u
    ON u._id = t.actor_id
   AND u._tenant_id = :tenantId
   AND u._deleted IS NOT TRUE
  WHERE t.actor_type = 'internal_user'
    AND t.revoked_at IS NULL
    AND t.expires_at > :now
`;

const OPEN_SESSIONS_SQL = `
  SELECT t._id AS "sessionId", t.actor_id AS "internalUserId", u.full_name AS "fullName", u.email AS "email",
         u.status AS "status", u.last_login_at AS "lastLoginAt", t.issued_at AS "renewedAt",
         t.expires_at AS "expiresAt", t.ip_address AS "ipAddress", t.user_agent AS "userAgent"
  ${OPEN_SESSIONS_FROM}
  ORDER BY t.issued_at DESC, t._id DESC
  LIMIT :limit OFFSET :offset
`;

const OPEN_SESSIONS_COUNT_SQL = `SELECT COUNT(*)::int AS "total", COUNT(DISTINCT t.actor_id)::int AS "people" ${OPEN_SESSIONS_FROM}`;

@Injectable()
export class InternalSessionsRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async listOpenSessions(
    tenantId: string,
    pagination: PaginationInput,
    now: Date,
  ): Promise<{ rows: InternalSessionRow[]; total: number; people: number }> {
    const [rows, counts] = await Promise.all([
      this.sequelize.query<InternalSessionRow>(OPEN_SESSIONS_SQL, {
        replacements: { tenantId, now, limit: pagination.limit, offset: toOffset(pagination) },
        type: QueryTypes.SELECT,
      }),
      this.sequelize.query<{ total: number; people: number }>(OPEN_SESSIONS_COUNT_SQL, {
        replacements: { tenantId, now },
        type: QueryTypes.SELECT,
      }),
    ]);
    return { rows, total: counts[0]?.total ?? 0, people: counts[0]?.people ?? 0 };
  }

  /** Revoca los tokens vivos de UNA persona y devuelve cuántos había. */
  async revokeOpenSessions(internalUserId: string, reason: string, now: Date): Promise<number> {
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE auth_refresh_tokens
          SET revoked_at = :now, revoked_reason = :reason
        WHERE actor_type = 'internal_user' AND actor_id = :internalUserId AND revoked_at IS NULL AND expires_at > :now
        RETURNING _id AS "id"`,
      { replacements: { internalUserId, reason, now }, type: QueryTypes.SELECT },
    );
    return rows.length;
  }
}
