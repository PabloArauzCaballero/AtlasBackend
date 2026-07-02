import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
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
        triggeredByInternalUserId: null,
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
    values: { tenantId: string; requestCode: string; customerId: string; requestType: string; dueAt: Date; requestedAt: Date },
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
        createdAtValue: values.requestedAt,
        updatedAtValue: values.requestedAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
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
        actorInternalUserId: null,
        actorPlatformUserId: null,
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
