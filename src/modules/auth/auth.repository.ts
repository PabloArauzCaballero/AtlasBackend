import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, fn, where, col } from 'sequelize';
import {
  AuthCredentialModel,
  AuthEventModel,
  AuthRefreshTokenModel,
  InternalUserModel,
  OperationalAuditLogModel,
  PlatformUserModel,
} from '../../database/models/index.js';

export type ActorType = 'customer' | 'internal_user' | 'platform_user';

export type LoginAttemptEvent = {
  tenantId: string | null;
  actorType: ActorType;
  actorId: string | null;
  eventType: 'login' | 'logout';
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
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(PlatformUserModel) private readonly platformUserModel: typeof PlatformUserModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditLogModel: typeof OperationalAuditLogModel,
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

  async findCredentialsByActor(actorType: ActorType, actorId: string): Promise<AuthCredentialModel | null> {
    return this.credentialModel.findOne({ where: { actorType, actorId, deleted: false } as never });
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

  async createRefreshToken(input: {
    tenantId: string | null;
    actorType: ActorType;
    actorId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<AuthRefreshTokenModel> {
    return this.refreshTokenModel.create({
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
    } as never);
  }

  async findActiveRefreshTokenByHash(tokenHash: string): Promise<AuthRefreshTokenModel | null> {
    return this.refreshTokenModel.findOne({ where: { tokenHash, revokedAt: null } as never });
  }

  async revokeRefreshToken(token: AuthRefreshTokenModel, reason: string, replacedByTokenId?: string): Promise<void> {
    token.revokedAt = new Date();
    token.revokedReason = reason;
    if (replacedByTokenId) token.replacedByTokenId = replacedByTokenId;
    await token.save();
  }

  async revokeAllRefreshTokensForActor(actorType: ActorType, actorId: string, reason: string): Promise<void> {
    await this.refreshTokenModel.update({ revokedAt: new Date(), revokedReason: reason } as never, {
      where: { actorType, actorId, revokedAt: null } as never,
    });
  }

  /**
   * Deja rastro firmado por el id del actor de cada intento de login/logout, sea exitoso o no.
   * `operational_audit_logs` cubre los tres tipos de actor (internal_user/platform_user vía
   * columnas dedicadas, customer en el payload). `auth_events` es además el historial de sesión
   * dedicado a clientes (mismo esquema que `customer_sessions`); antes de este cambio el modelo
   * existía pero ningún flujo lo escribía, así que no había forma de listar intentos de login
   * previos de un cliente, solo el último (`auth_credentials.lastLoginAt`).
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
