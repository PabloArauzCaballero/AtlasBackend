/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Deja el rastro de cada intento de login/logout, exitoso o no, firmado por el actor.
 * @system escribe operational_audit_logs para todo actor y auth_events para los clientes.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthEventModel, OperationalAuditLogModel } from '../../database/models/index.js';
import type { LoginAttemptEvent } from './auth-vocabulary.js';

@Injectable()
export class AuthEventRepository {
  constructor(
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditLogModel: typeof OperationalAuditLogModel,
  ) {}

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
