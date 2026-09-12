/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system persiste una familia de señales de telemetría del cliente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerObservationModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import type { RepositoryOptions } from './telemetry-repository-options.js';

/**
 * Actividad del cliente y su rastro: acciones, observaciones derivadas, el resumen de actividad que
 * consulta el portal y la auditoría operativa de la propia ingesta.
 */
@Injectable()
export class TelemetryActivityRepository {
  constructor(
    @InjectModel(CustomerActionLogModel)
    private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(CustomerObservationModel)
    private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(CustomerActivitySummaryModel)
    private readonly customerActivitySummaryModel: typeof CustomerActivitySummaryModel,
    @InjectModel(OperationalAuditLogModel)
    private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
  ) {}

  createCustomerAction(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      eventName: string;
      screenName: string | null;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.customerActionLogModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventName: values.eventName,
        screenName: values.screenName,
        actionPayloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      observationCode: string;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: null,
        valueJson: values.payload,
        sourceType: 'telemetry_batch',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'observed',
        capturedAt: values.occurredAt,
        validFrom: values.occurredAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  async upsertActivitySummary(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      eventCount: number;
      now: Date;
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
          totalSessions: 1,
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
          computationVersion: 'telemetry-batch-v1',
        },
        { transaction: options.transaction },
      );
      return;
    }
    existing.lastSessionAt = values.now;
    existing.usualDeviceId = values.deviceId;
    existing.totalSessions = (existing.totalSessions ?? 0) + 1;
    existing.recomputedAt = values.now;
    existing.computationVersion = 'telemetry-batch-v1';
    await existing.save({ transaction: options.transaction });
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actorPlatformUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
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
        actorPlatformUserId: values.actorPlatformUserId,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
