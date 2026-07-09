import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { CustomerActivitySummaryModel, OperationalAuditLogModel } from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `sessions.repository.ts`. Responsabilidad única:
 * resumen agregado de actividad del cliente (`customer_activity_summaries`) y auditoría
 * operativa asociada a sesiones. Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class SessionsActivityAuditRepository {
  constructor(
    @InjectModel(CustomerActivitySummaryModel) private readonly customerActivitySummaryModel: typeof CustomerActivitySummaryModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
  ) {}

  async upsertActivitySummary(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      now: Date;
      incrementSessionCount: boolean;
    },
    options: RepositoryOptions,
  ): Promise<void> {
    const existing = await this.customerActivitySummaryModel.findOne({
      where: { tenantId: values.tenantId, customerId: values.customerId },
      transaction: options.transaction,
    } as FindOptions);

    if (!existing) {
      await this.customerActivitySummaryModel.create(
        {
          tenantId: values.tenantId,
          customerId: values.customerId,
          firstSessionAt: values.now,
          lastSessionAt: values.now,
          firstDeviceId: values.deviceId,
          usualDeviceId: values.deviceId,
          totalSessions: values.incrementSessionCount ? 1 : 0,
          totalDevicesSeen: 1,
          failedLoginCount7d: 0,
          deviceChangeCount30d: 0,
          suspiciousIpCount30d: 0,
          currentRiskLevel: null,
          currentTrustTier: null,
          lastRiskAssessmentId: null,
          lastRiskAssessedAt: null,
          watchlistHitCountLifetime: 0,
          fraudCaseCountLifetime: 0,
          openManualReviewCount: 0,
          recomputedAt: values.now,
          computationVersion: 'sessions-v1',
        },
        { transaction: options.transaction },
      );
      return;
    }

    existing.lastSessionAt = values.now;
    existing.usualDeviceId = values.deviceId;
    if (values.incrementSessionCount) {
      existing.totalSessions = (existing.totalSessions ?? 0) + 1;
    }
    existing.recomputedAt = values.now;
    existing.computationVersion = 'sessions-v1';
    await existing.save({ transaction: options.transaction });
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
      userAgent: string | null;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        payloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionAudits(tenantId: string, sessionId: string, limit = 30): Promise<OperationalAuditLogModel[]> {
    return this.operationalAuditLogModel.findAll({
      where: { tenantId, targetType: 'session', targetId: sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }
}
