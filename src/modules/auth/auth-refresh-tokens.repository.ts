/**
 * @file Puerto de persistencia: refresh tokens (alta, rotación, revocación en cadena y rastro de reuso).
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthRefreshTokenModel, OperationalAuditLogModel } from '../../database/models/index.js';
import type { ActorType } from './auth-vocabulary.js';

@Injectable()
export class AuthRefreshTokensRepository {
  constructor(
    @InjectModel(AuthRefreshTokenModel) private readonly refreshTokenModel: typeof AuthRefreshTokenModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditLogModel: typeof OperationalAuditLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async createRefreshToken(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      tokenHash: string;
      expiresAt: Date;
      sessionStartedAt: Date;
      userAgent: string | null;
      ipAddress: string | null;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<AuthRefreshTokenModel> {
    return this.refreshTokenModel.create(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        tokenHash: input.tokenHash,
        issuedAt: new Date(),
        expiresAt: input.expiresAt,
        sessionStartedAt: input.sessionStartedAt,
        revokedAt: null,
        revokedReason: null,
        replacedByTokenId: null,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        createdAtValue: new Date(),
      } as never,
      { transaction: options.transaction },
    );
  }

  async findActiveRefreshTokenByHash(tokenHash: string): Promise<AuthRefreshTokenModel | null> {
    return this.refreshTokenModel.findOne({ where: { tokenHash, revokedAt: null } as never });
  }

  /**
   * ATLAS-P0-AUTH-001: usado exclusivamente por el flujo de rotación (`AuthService.refresh`).
   * `FOR UPDATE` bloquea la fila hasta que la transacción llamante haga commit/rollback — una
   * segunda solicitud de refresh concurrente con el mismo token queda esperando aquí en vez de
   * leer el estado "todavía activo" y rotar el mismo token dos veces. No filtra por
   * `revokedAt: null` a propósito: si el token ya fue rotado, este mismo método es el que permite
   * detectar el reuso (ver `revokedReason === 'rotated'` en el service).
   */
  async findRefreshTokenForUpdate(tokenHash: string, transaction: Transaction): Promise<AuthRefreshTokenModel | null> {
    return this.refreshTokenModel.findOne({
      where: { tokenHash } as never,
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
  }

  async revokeRefreshToken(
    token: AuthRefreshTokenModel,
    reason: string,
    replacedByTokenId?: string,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    token.revokedAt = new Date();
    token.revokedReason = reason;
    if (replacedByTokenId) token.replacedByTokenId = replacedByTokenId;
    await token.save({ transaction: options.transaction });
  }

  async revokeAllRefreshTokensForActor(actorType: ActorType, actorId: string, reason: string): Promise<void> {
    await this.refreshTokenModel.update({ revokedAt: new Date(), revokedReason: reason } as never, {
      where: { actorType, actorId, revokedAt: null } as never,
    });
  }

  /**
   * Revoca, dentro de la misma transacción, toda la cadena de descendientes todavía activos de un
   * token reutilizado — recorre `replaced_by_token_id` hacia adelante con una CTE recursiva.
   * `startTokenId` es el token presentado en la solicitud de reuso (ya revocado por rotación); se
   * excluye de la revocación porque ya está revocado. Retorna los ids efectivamente revocados,
   * para dejar constancia exacta en la auditoría de cuántas sesiones descendientes se cortaron.
   */
  async revokeDescendantChain(startTokenId: string, transaction: Transaction): Promise<string[]> {
    const rows = await this.sequelize.query<{ _id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT _id, replaced_by_token_id FROM auth_refresh_tokens WHERE _id = :startId
         UNION ALL
         SELECT t._id, t.replaced_by_token_id
         FROM auth_refresh_tokens t
         JOIN chain c ON t._id = c.replaced_by_token_id
       )
       UPDATE auth_refresh_tokens
       SET revoked_at = :now, revoked_reason = 'reuse_detected'
       WHERE _id IN (SELECT _id FROM chain WHERE _id <> :startId)
         AND revoked_at IS NULL
       RETURNING _id;`,
      { replacements: { startId: startTokenId, now: new Date() }, transaction, type: QueryTypes.SELECT },
    );
    return rows.map((row) => String(row._id));
  }

  async recordRefreshReuseEvent(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      reusedTokenId: string;
      revokedDescendantIds: string[];
    },
    transaction: Transaction,
  ): Promise<void> {
    const now = new Date();
    await this.auditLogModel.create(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorInternalUserId: input.actorType === 'internal_user' ? input.actorId : null,
        actorPlatformUserId: input.actorType === 'platform_user' ? input.actorId : null,
        actionCode: 'auth.refresh_token.reuse_detected',
        targetType: 'auth_refresh_token',
        targetId: input.reusedTokenId,
        ipAddress: null,
        userAgent: null,
        payloadJson: {
          actorType: input.actorType,
          revokedDescendantCount: input.revokedDescendantIds.length,
          revokedDescendantIds: input.revokedDescendantIds,
        },
        occurredAt: now,
        createdAtValue: now,
      } as never,
      { transaction },
    );
  }
}
