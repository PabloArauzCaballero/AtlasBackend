import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { AuthCredentialModel, AuthRefreshTokenModel, InternalUserModel, PlatformUserModel } from '../../database/models/index.js';

export type ActorType = 'customer' | 'internal_user' | 'platform_user';

@Injectable()
export class AuthRepository {
  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(AuthRefreshTokenModel) private readonly refreshTokenModel: typeof AuthRefreshTokenModel,
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(PlatformUserModel) private readonly platformUserModel: typeof PlatformUserModel,
  ) {}

  async findInternalUserByEmail(email: string): Promise<InternalUserModel | null> {
    return this.internalUserModel.findOne({ where: { email, deleted: { [Op.ne]: true } } as never });
  }

  async findPlatformUserByEmail(email: string): Promise<PlatformUserModel | null> {
    return this.platformUserModel.findOne({ where: { email, deleted: { [Op.ne]: true } } as never });
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
    credential.failedLoginAttempts = 0;
    credential.lockedUntil = null;
    credential.lastLoginAt = new Date();
    credential.lastLoginIp = ip;
    credential.updatedAtValue = new Date();
    await credential.save();
  }

  async bumpTokenVersion(credential: AuthCredentialModel): Promise<number> {
    credential.tokenVersion += 1;
    credential.updatedAtValue = new Date();
    await credential.save();
    return credential.tokenVersion;
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
}
