/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Custodia la contraseña, el MFA y el bloqueo por intentos fallidos de cada actor.
 * @system lee y escribe auth_credentials con reserva atómica de intentos y registra el último acceso exitoso.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { AuthCredentialModel, InternalUserModel } from '../../database/models/index.js';
import { loginAttemptReservation, type LoginAttemptLimits } from './auth-login-attempts.js';
import type { ActorType } from './auth-vocabulary.js';

@Injectable()
export class AuthCredentialRepository {
  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
  ) {}

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

  /** Fase 4.2: activa/desactiva el MFA opt-in de una credencial (usado por el flujo de cliente). */
  async setMfaEnabled(credential: AuthCredentialModel, enabled: boolean): Promise<void> {
    credential.mfaEnabled = enabled;
    credential.updatedAtValue = new Date();
    await credential.save();
  }

  /** Reserva atómica del intento (ver `loginAttemptReservation`). `null` = reservado; si no, la cuenta está bloqueada. */
  async reserveLoginAttempt(credentialId: string, limits: LoginAttemptLimits): Promise<{ lockedUntil: Date | null } | null> {
    const [reserved] = await this.credentialModel.update(...loginAttemptReservation(credentialId, limits));
    if (reserved > 0) return null;
    const locked = await this.credentialModel.findOne({ where: { id: credentialId } as never, attributes: ['lockedUntil'] });
    return { lockedUntil: locked?.lockedUntil ?? null };
  }

  /** El secreto fue correcto: el intento reservado deja de contar (y con él los fallos previos). */
  async clearFailedAttempts(credentialId: string): Promise<void> {
    const values = { failedLoginAttempts: 0, lockedUntil: null, updatedAtValue: new Date() };
    await this.credentialModel.update(values as never, { where: { id: credentialId } as never });
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
}
