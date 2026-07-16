import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction, fn, where, col } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  AuthCredentialModel,
  AuthEventModel,
  AuthOneTimeCodeModel,
  AuthRefreshTokenModel,
  InternalUserModel,
  OperationalAuditLogModel,
  PlatformUserModel,
} from '../../database/models/index.js';

export type ActorType = 'customer' | 'internal_user' | 'platform_user';

export type OneTimeCodePurpose = 'password_reset' | 'login_pin';

export type LoginAttemptEvent = {
  tenantId: string | null;
  actorType: ActorType;
  actorId: string | null;
  eventType: 'login' | 'logout' | 'login_pin_challenge' | 'password_reset_request' | 'password_reset';
  successful: boolean;
  failureReasonCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

@Injectable()
export class AuthRepository {
  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(AuthRefreshTokenModel) private readonly refreshTokenModel: typeof AuthRefreshTokenModel,
    @InjectModel(AuthOneTimeCodeModel) private readonly oneTimeCodeModel: typeof AuthOneTimeCodeModel,
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(PlatformUserModel) private readonly platformUserModel: typeof PlatformUserModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditLogModel: typeof OperationalAuditLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  // ATLAS-P10-045: antes esta búsqueda era case-sensitive tal como estaba almacenado en la
  // base de datos (ver docs/architecture/assumptions.md, "emails de internal_users/platform_users
  // tratados como case-sensitive"). Hoy el único punto de alta es el seeder de desarrollo, que
  // ya inserta en minúsculas, pero comparar con `LOWER(email) = LOWER(:input)` hace la búsqueda
  // robusta independientemente de cómo se haya insertado el registro (seed manual, migración
  // futura, o el módulo de gestión de usuarios internos de ATLAS-PEND-108 cuando exista), sin
  // requerir una migración de datos para los registros ya existentes.
  async findInternalUserByEmail(email: string, tenantId?: string): Promise<InternalUserModel | null> {
    const filters: unknown[] = [where(fn('lower', col('email')), email.trim().toLowerCase()), { deleted: { [Op.ne]: true } }];
    if (tenantId) filters.push({ tenantId });

    return this.internalUserModel.findOne({
      where: { [Op.and]: filters } as never,
    });
  }

  async findPlatformUserByEmail(email: string): Promise<PlatformUserModel | null> {
    return this.platformUserModel.findOne({
      where: { [Op.and]: [where(fn('lower', col('email')), email.trim().toLowerCase()), { deleted: { [Op.ne]: true } }] } as never,
    });
  }

  async findInternalUserById(id: string): Promise<InternalUserModel | null> {
    return this.internalUserModel.findOne({ where: { id } as never });
  }

  async findPlatformUserById(id: string): Promise<PlatformUserModel | null> {
    return this.platformUserModel.findOne({ where: { id } as never });
  }

  async findCredentialsByActor(
    actorType: ActorType,
    actorId: string,
    options: { transaction?: Transaction } = {},
  ): Promise<AuthCredentialModel | null> {
    return this.credentialModel.findOne({ where: { actorType, actorId, deleted: false } as never, transaction: options.transaction });
  }

  async createCredentials(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      passwordHash: string;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<AuthCredentialModel> {
    const now = new Date();
    return this.credentialModel.create(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        passwordHash: input.passwordHash,
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAtValue: now,
        updatedAtValue: now,
        deleted: false,
      } as never,
      { transaction: options.transaction },
    );
  }

  async updatePasswordHash(credential: AuthCredentialModel, passwordHash: string): Promise<void> {
    credential.passwordHash = passwordHash;
    credential.failedLoginAttempts = 0;
    credential.lockedUntil = null;
    credential.updatedAtValue = new Date();
    await credential.save();
  }

  /**
   * Crea un código de un solo uso y consume cualquier código anterior todavía activo del mismo
   * actor+propósito: nunca hay más de un código vigente, así reenviar un código invalida el
   * anterior en vez de multiplicar las combinaciones válidas.
   */
  async createOneTimeCode(input: {
    tenantId: string | null;
    actorType: ActorType;
    actorId: string;
    purpose: OneTimeCodePurpose;
    codeHash: string;
    challengeHash: string | null;
    expiresAt: Date;
  }): Promise<AuthOneTimeCodeModel> {
    const now = new Date();
    await this.oneTimeCodeModel.update({ consumedAt: now } as never, {
      where: { actorType: input.actorType, actorId: input.actorId, purpose: input.purpose, consumedAt: null } as never,
    });

    return this.oneTimeCodeModel.create({
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      purpose: input.purpose,
      codeHash: input.codeHash,
      challengeHash: input.challengeHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      attempts: 0,
      createdAtValue: now,
    } as never);
  }

  async findActiveOneTimeCodeByActor(actorType: ActorType, actorId: string, purpose: OneTimeCodePurpose): Promise<AuthOneTimeCodeModel | null> {
    return this.oneTimeCodeModel.findOne({
      where: { actorType, actorId, purpose, consumedAt: null } as never,
      order: [['id', 'DESC']],
    });
  }

  async findActiveOneTimeCodeByChallenge(challengeHash: string): Promise<AuthOneTimeCodeModel | null> {
    return this.oneTimeCodeModel.findOne({ where: { challengeHash, consumedAt: null } as never });
  }

  async registerOneTimeCodeFailedAttempt(code: AuthOneTimeCodeModel, maxAttempts: number): Promise<void> {
    code.attempts += 1;
    if (code.attempts >= maxAttempts) {
      // Agotó los intentos: se consume para que ni siquiera el código correcto sirva después.
      code.consumedAt = new Date();
    }
    await code.save();
  }

  async consumeOneTimeCode(code: AuthOneTimeCodeModel): Promise<void> {
    code.consumedAt = new Date();
    await code.save();
  }

  async recordFailedAttempt(credential: AuthCredentialModel, input: { maxAttempts: number; lockoutMinutes: number }): Promise<void> {
    credential.failedLoginAttempts += 1;
    if (credential.failedLoginAttempts >= input.maxAttempts) {
      credential.lockedUntil = new Date(Date.now() + input.lockoutMinutes * 60_000);
      credential.failedLoginAttempts = 0;
    }
    credential.updatedAtValue = new Date();
    await credential.save();
  }

  async recordSuccessfulLogin(credential: AuthCredentialModel, ip: string | null): Promise<void> {
    const now = new Date();
    credential.failedLoginAttempts = 0;
    credential.lockedUntil = null;
    credential.lastLoginAt = now;
    credential.lastLoginIp = ip;
    credential.updatedAtValue = now;
    await credential.save();

    if (credential.actorType === 'internal_user') {
      await this.internalUserModel.update({ lastLoginAt: now, updatedAtValue: now } as never, {
        where: { id: credential.actorId, deleted: { [Op.ne]: true } } as never,
      });
    }
  }

  async createRefreshToken(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      tokenHash: string;
      expiresAt: Date;
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

  /**
   * Deja rastro firmado por el id del actor de cada intento de login/logout, sea exitoso o no.
   * `operational_audit_logs` cubre los tres tipos de actor (internal_user/platform_user vía
   * columnas dedicadas, customer en el payload). `auth_events` mantiene el historial dedicado de
   * autenticación de clientes.
   */
  async recordLoginAttemptEvent(event: LoginAttemptEvent): Promise<void> {
    const now = new Date();
    await this.auditLogModel.create({
      tenantId: event.tenantId,
      actorType: event.actorType,
      actorInternalUserId: event.actorType === 'internal_user' ? event.actorId : null,
      actorPlatformUserId: event.actorType === 'platform_user' ? event.actorId : null,
      actionCode: `auth.${event.eventType}.${event.successful ? 'success' : 'failure'}`,
      targetType: 'actor',
      targetId: event.actorId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      payloadJson: {
        actorType: event.actorType,
        failureReasonCode: event.failureReasonCode,
        ...(event.actorType === 'customer' && event.actorId ? { customerId: event.actorId } : {}),
      },
      occurredAt: now,
      createdAtValue: now,
    } as never);

    if (event.actorType === 'customer' && event.tenantId) {
      await this.authEventModel.create({
        tenantId: event.tenantId,
        customerId: event.actorId,
        sessionId: null,
        deviceId: null,
        eventType: event.eventType,
        loginSuccessful: event.eventType === 'login' ? event.successful : null,
        failureReasonCode: event.failureReasonCode,
        occurredAt: now,
        ipAddress: event.ipAddress,
        createdAtValue: now,
      } as never);
    }
  }
}
