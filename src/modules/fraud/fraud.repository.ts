import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  FraudCaseModel,
  OperationalAuditLogModel,
  WatchlistEntryModel,
} from '../../database/models/index.js';

/**
 * ATLAS-AUDIT-014 (cerrado en este patch): repositorio de escritura de decisiones de fraude,
 * extraído de `operations.repository.ts`. `createStatusEvent`, `createCustomerObservation`,
 * `createOperationalAudit` y `createDataChange` están intencionalmente duplicados aquí (y en
 * `OperationsRepository`, que los sigue usando desde `decideManualReviewCase`): son escrituras
 * genéricas de una sola fila sobre tablas usadas por múltiples dominios, de bajo riesgo de
 * divergencia. No se extrajeron a un repositorio "compartido" separado para no introducir una
 * dependencia cruzada adicional entre `fraud` y `operations` en ninguna dirección.
 */
@Injectable()
export class FraudRepository {
  constructor(
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(FraudCaseEventModel) private readonly fraudCaseEventModel: typeof FraudCaseEventModel,
    @InjectModel(WatchlistEntryModel) private readonly watchlistEntryModel: typeof WatchlistEntryModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  findFraudCaseById(tenantId: string, caseId: string): Promise<FraudCaseModel | null> {
    return this.fraudCaseModel.findOne({ where: { tenantId, id: caseId, deleted: { [Op.ne]: true } } } as FindOptions);
  }

  async closeFraudCase(
    caseModel: FraudCaseModel,
    values: { resolution: string; notes: string | null; closedAt: Date; nextStatus: string },
    options: { transaction?: Transaction },
  ): Promise<FraudCaseModel> {
    caseModel.caseStatus = values.nextStatus;
    caseModel.resolution = values.resolution;
    caseModel.notes = values.notes;
    caseModel.closedAt = values.closedAt;
    caseModel.updatedAtValue = values.closedAt;
    return caseModel.save({ transaction: options.transaction });
  }

  createFraudCaseEvent(
    values: {
      tenantId: string;
      caseId: string;
      eventType: string;
      actorType: string;
      actorInternalUserId: string | null;
      payload: Record<string, unknown>;
      notes: string | null;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<FraudCaseEventModel> {
    return this.fraudCaseEventModel.create(
      {
        tenantId: values.tenantId,
        fraudCaseId: values.caseId,
        eventType: values.eventType,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        happenedAt: values.happenedAt,
        payloadJson: values.payload,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createWatchlistEntry(
    values: {
      tenantId: string;
      entityType: string;
      entityHash: string | null;
      reasonCode: string;
      severity: string;
      actorInternalUserId: string | null;
      createdAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<WatchlistEntryModel> {
    return this.watchlistEntryModel.create(
      {
        tenantId: values.tenantId,
        scope: 'tenant',
        countryCode: 'BOL',
        entityType: values.entityType,
        entityHash: values.entityHash,
        entityLast4: null,
        reasonCode: values.reasonCode,
        severity: values.severity,
        status: 'active',
        sourceType: 'fraud_decision',
        createdByType: 'internal_user',
        createdByInternalUserId: values.actorInternalUserId,
        createdByPlatformUserId: null,
        expiresAt: null,
        createdAtValue: values.createdAt,
        updatedAtValue: values.createdAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      actorType: string;
      happenedAt: Date;
      notes: string | null;
    },
    options: { transaction?: Transaction },
  ): Promise<CustomerStatusEventModel> {
    return this.customerStatusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.actorType,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerObservation(
    values: { tenantId: string; customerId: string; observationCode: string; payload: Record<string, unknown>; happenedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: null,
        deviceId: null,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: null,
        valueJson: values.payload,
        sourceType: 'operations',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'operator_decision',
        capturedAt: values.happenedAt,
        validFrom: values.happenedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createOperationalAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
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
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: {
      tenantId: string;
      tableName: string;
      recordId: string;
      changeType: string;
      actorType: string;
      actorInternalUserId: string | null;
      reason: string;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
