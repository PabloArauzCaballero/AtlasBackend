/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace exigibles los derechos de privacidad y limita el uso de datos personales.
 * @system gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  CustomerActionLogModel,
  CustomerConsentModel,
  ConsentEventModel,
  CustomerStatusEventModel,
  DataSubjectRequestModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class CustomerPrivacyRepository {
  constructor(
    @InjectModel(CustomerConsentModel) private readonly customerConsentModel: typeof CustomerConsentModel,
    @InjectModel(ConsentEventModel) private readonly consentEventModel: typeof ConsentEventModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(DataSubjectRequestModel) private readonly dataSubjectRequestModel: typeof DataSubjectRequestModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
  ) {}

  createCustomerConsent(
    values: {
      tenantId: string;
      customerId: string;
      consentDocumentId: string;
      purposeCode: string;
      granted: boolean;
      revoked: boolean;
      channel: string;
      sessionId: string | null;
      ipAddress: string | null;
      happenedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerConsentModel> {
    return this.customerConsentModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        consentDocumentId: values.consentDocumentId,
        purposeCode: values.purposeCode,
        granted: values.granted,
        grantedAt: values.granted ? values.happenedAt : null,
        revokedAt: values.revoked ? values.happenedAt : null,
        channel: values.channel,
        sessionId: values.sessionId,
        ipAddress: values.ipAddress,
        deviceFingerprintSnapshot: null,
        userAgent: null,
        evidenceSnapshotUrl: null,
        createdAtValue: values.happenedAt,
        updatedAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createConsentEvent(
    values: {
      tenantId: string;
      customerConsentId: string;
      eventType: string;
      channel: string;
      sessionId: string | null;
      ipAddress: string | null;
      actorType: string;
      actorInternalUserId: string | null;
      notes: string | null;
      happenedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<ConsentEventModel> {
    return this.consentEventModel.create(
      {
        tenantId: values.tenantId,
        customerConsentId: values.customerConsentId,
        eventType: values.eventType,
        happenedAt: values.happenedAt,
        channel: values.channel,
        sessionId: values.sessionId,
        ipAddress: values.ipAddress,
        deviceFingerprintSnapshot: null,
        triggeredByType: values.actorType,
        triggeredByInternalUserId: values.actorInternalUserId,
        notes: values.notes,
        createdAtValue: values.happenedAt,
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
      actorInternalUserId: string | null;
      actorPlatformUserId: string | null;
      happenedAt: Date;
      notes: string | null;
    },
    options: RepositoryOptions,
  ): Promise<CustomerStatusEventModel> {
    return this.customerStatusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: values.actorPlatformUserId,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createActionLog(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      eventName: string;
      payload: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.customerActionLogModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: null,
        eventName: values.eventName,
        screenName: 'privacy',
        actionPayloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataSubjectRequest(
    values: {
      tenantId: string;
      requestCode: string;
      customerId: string;
      requestType: string;
      dueAt: Date;
      requestedAt: Date;
      description: string | null;
      rectificationField: string | null;
      proposedValueEncrypted: Buffer | null;
      pinVerifiedAt: Date | null;
    },
    options: RepositoryOptions,
  ): Promise<DataSubjectRequestModel> {
    return this.dataSubjectRequestModel.create(
      {
        tenantId: values.tenantId,
        requestCode: values.requestCode,
        customerId: values.customerId,
        requestType: values.requestType,
        status: 'received',
        requestedAt: values.requestedAt,
        dueAt: values.dueAt,
        resolvedAt: null,
        handledBy: null,
        resolutionNotes: null,
        description: values.description,
        rectificationField: values.rectificationField,
        proposedValueEncrypted: values.proposedValueEncrypted,
        pinVerifiedAt: values.pinVerifiedAt,
        createdAtValue: values.requestedAt,
        updatedAtValue: values.requestedAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  /** Lee la solicitud bloqueando la fila: dos personas moviendo la misma a la vez no pueden pisarse. */
  findDataSubjectRequestForUpdate(tenantId: string, requestId: string, options: Required<RepositoryOptions>) {
    return this.dataSubjectRequestModel.findOne({
      where: { tenantId, id: requestId },
      transaction: options.transaction,
      lock: options.transaction.LOCK.UPDATE,
    });
  }

  updateDataSubjectRequest(
    request: DataSubjectRequestModel,
    values: { status: string; handledBy: string | null; resolvedAt: Date | null; resolutionNotes: string | null; updatedAt: Date },
    options: RepositoryOptions,
  ): Promise<DataSubjectRequestModel> {
    return request.update(
      {
        status: values.status,
        handledBy: values.handledBy,
        resolvedAt: values.resolvedAt,
        resolutionNotes: values.resolutionNotes,
        updatedAtValue: values.updatedAt,
      },
      { transaction: options.transaction },
    );
  }

  /**
   * La última vez que la persona confirmó su PIN desde `since`, según la auditoría que escribe `/auth/pin/verify`
   * (`auth.pin_verify.success`). La constancia la da el servidor: la app no puede afirmar que se confirmó.
   */
  async findLastPinVerification(tenantId: string, customerId: string, since: Date): Promise<Date | null> {
    const fila = await this.operationalAuditLogModel.findOne({
      where: {
        tenantId,
        actionCode: 'auth.pin_verify.success',
        targetType: 'actor',
        targetId: customerId,
        occurredAt: { [Op.gte]: since },
      },
      order: [['occurredAt', 'DESC']],
    });
    return fila?.occurredAt ?? null;
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
      payload: Record<string, unknown>;
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
