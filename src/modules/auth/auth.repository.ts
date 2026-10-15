/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, fn, where, col } from 'sequelize';
import {
  AuthCredentialModel,
  AuthEventModel,
  InternalUserModel,
  OperationalAuditLogModel,
  PlatformUserModel,
} from '../../database/models/index.js';

import { loginAttemptReservation, type LoginAttemptLimits } from './auth-login-attempts.js';
import type { ActorType, LoginAttemptEvent } from './auth-vocabulary.js';

// El vocabulario (actores, propósitos de OTP, tipos de evento) vive en `auth-vocabulary.ts` y se
// reexporta desde aquí: es el import que ya usaban veintitantos archivos y romperlo no compraba
// nada. Se movió porque este archivo tiene el tamaño congelado y cada término nuevo pasaba de 140
// columnas, así que prettier partía la unión en varias líneas y el trinquete rechazaba el commit.
export type { ActorType, AuthEventType, LoginAttemptEvent, OneTimeCodePurpose } from './auth-vocabulary.js';

@Injectable()
export class AuthRepository {
  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
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
