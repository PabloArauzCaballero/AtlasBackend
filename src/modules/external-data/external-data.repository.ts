import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerObservationModel,
  DataProviderModel,
  DataProviderRequestModel,
  DataProviderResponseModel,
  ExternalProviderCostPolicyModel,
  FeatureSnapshotModel,
  ProviderHealthLogModel,
} from '../../database/models/index.js';
import { NormalizedExternalObservation, ProviderHealthResult } from './domain/external-provider.types.js';

type QueryOptions = { transaction?: Transaction };

@Injectable()
export class ExternalDataRepository {
  constructor(
    @InjectModel(DataProviderModel) private readonly dataProviderModel: typeof DataProviderModel,
    @InjectModel(ExternalProviderCostPolicyModel) private readonly costPolicyModel: typeof ExternalProviderCostPolicyModel,
    @InjectModel(CustomerConsentModel) private readonly customerConsentModel: typeof CustomerConsentModel,
    @InjectModel(DataProviderRequestModel) private readonly dataProviderRequestModel: typeof DataProviderRequestModel,
    @InjectModel(DataProviderResponseModel) private readonly dataProviderResponseModel: typeof DataProviderResponseModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(FeatureSnapshotModel) private readonly featureSnapshotModel: typeof FeatureSnapshotModel,
    @InjectModel(ProviderHealthLogModel) private readonly providerHealthLogModel: typeof ProviderHealthLogModel,
  ) {}

  findProviderByCode(providerCode: string): Promise<DataProviderModel | null> {
    return this.dataProviderModel.findOne({ where: { providerCode } });
  }

  findProviderById(providerId: string): Promise<DataProviderModel | null> {
    return this.dataProviderModel.findByPk(providerId);
  }

  listProviders(): Promise<DataProviderModel[]> {
    return this.dataProviderModel.findAll({ order: [['provider_code', 'ASC']] });
  }

  findProviderRequestById(requestId: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findByPk(requestId);
  }

  findProviderRequestByIdAndTenant(tenantId: string, requestId: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findOne({ where: { tenantId, id: requestId } });
  }

  findProviderResponsesByRequestId(requestId: string): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({
      where: { providerRequestId: requestId },
      order: [['_created_at', 'DESC']],
      limit: 10,
    });
  }

  findProviderResponsesByRequestIdAndTenant(tenantId: string, requestId: string): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({
      where: { tenantId, providerRequestId: requestId },
      order: [['_created_at', 'DESC']],
      limit: 10,
    });
  }

  findIdempotentProviderRequest(tenantId: string, idempotencyKey: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findOne({ where: { tenantId, idempotencyKey }, order: [['_created_at', 'DESC']] });
  }

  findReusableProviderRequest(input: {
    tenantId: string;
    providerId: string;
    customerId?: string;
    queryType: string;
    requestPayloadHash: string;
    since: Date;
  }): Promise<DataProviderRequestModel | null> {
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      providerId: input.providerId,
      requestType: input.queryType,
      requestPayloadHash: input.requestPayloadHash,
      responseStatus: { [Op.in]: ['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'] },
      requestedAt: { [Op.gte]: input.since },
    };
    if (input.customerId) where.customerId = input.customerId;
    return this.dataProviderRequestModel.findOne({ where, order: [['requested_at', 'DESC']] });
  }

  listProviderRequests(input: {
    tenantId?: string;
    providerId?: string;
    customerId?: string;
    from: Date;
    to?: Date;
    limit?: number;
  }): Promise<DataProviderRequestModel[]> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from } };
    if (input.to) where.requestedAt = { [Op.gte]: input.from, [Op.lt]: input.to };
    if (input.tenantId) where.tenantId = input.tenantId;
    if (input.providerId) where.providerId = input.providerId;
    if (input.customerId) where.customerId = input.customerId;
    return this.dataProviderRequestModel.findAll({ where, order: [['requested_at', 'DESC']], limit: input.limit ?? 5000 });
  }

  listRecentProviderResponses(limit: number): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({ order: [['_created_at', 'DESC']], limit });
  }

  listCustomerObservations(tenantId: string, customerId: string, limit = 50): Promise<CustomerObservationModel[]> {
    return this.customerObservationModel.findAll({
      where: { tenantId, customerId, sourceType: 'external_provider' },
      order: [['captured_at', 'DESC']],
      limit,
    });
  }

  listCustomerFeatureSnapshots(tenantId: string, customerId: string, limit = 20): Promise<FeatureSnapshotModel[]> {
    return this.featureSnapshotModel.findAll({
      where: { tenantId, customerId, triggeringEntityType: 'data_provider_request' },
      order: [['_created_at', 'DESC']],
      limit,
    });
  }

  listCostPolicies(providerId: string): Promise<ExternalProviderCostPolicyModel[]> {
    return this.costPolicyModel.findAll({ where: { providerId }, order: [['query_type', 'ASC']] });
  }

  async updateCostPolicy(
    providerId: string,
    queryType: string,
    patch: Partial<{
      unitCostAmount: number;
      currency: string;
      costTier: string;
      maxQueriesPerUserPerDay: number | null;
      maxQueriesPerUserPerMonth: number | null;
      maxQueriesGlobalPerDay: number | null;
      allowedDecisionStagesJson: string[];
      requiresManualApproval: boolean;
      requiresAdminRole: boolean;
      blockByDefault: boolean;
      cacheTtlSeconds: number | null;
      featureTtlSeconds: number | null;
      retryMaxAttempts: number | null;
      retryBackoffSeconds: number | null;
      active: boolean;
    }>,
  ): Promise<ExternalProviderCostPolicyModel | null> {
    const policy = await this.costPolicyModel.findOne({ where: { providerId, queryType } });
    if (!policy) return null;
    const update: Record<string, unknown> = { updatedAtValue: new Date() };
    if (patch.unitCostAmount !== undefined) update.unitCostAmount = patch.unitCostAmount.toFixed(4);
    if (patch.currency !== undefined) update.currency = patch.currency;
    if (patch.costTier !== undefined) update.costTier = patch.costTier;
    if (patch.maxQueriesPerUserPerDay !== undefined) update.maxQueriesPerUserPerDay = patch.maxQueriesPerUserPerDay;
    if (patch.maxQueriesPerUserPerMonth !== undefined) update.maxQueriesPerUserPerMonth = patch.maxQueriesPerUserPerMonth;
    if (patch.maxQueriesGlobalPerDay !== undefined) update.maxQueriesGlobalPerDay = patch.maxQueriesGlobalPerDay;
    if (patch.allowedDecisionStagesJson !== undefined) update.allowedDecisionStagesJson = patch.allowedDecisionStagesJson;
    if (patch.requiresManualApproval !== undefined) update.requiresManualApproval = patch.requiresManualApproval;
    if (patch.requiresAdminRole !== undefined) update.requiresAdminRole = patch.requiresAdminRole;
    if (patch.blockByDefault !== undefined) update.blockByDefault = patch.blockByDefault;
    if (patch.cacheTtlSeconds !== undefined) update.cacheTtlSeconds = patch.cacheTtlSeconds;
    if (patch.featureTtlSeconds !== undefined) update.featureTtlSeconds = patch.featureTtlSeconds;
    if (patch.retryMaxAttempts !== undefined) update.retryMaxAttempts = patch.retryMaxAttempts;
    if (patch.retryBackoffSeconds !== undefined) update.retryBackoffSeconds = patch.retryBackoffSeconds;
    if (patch.active !== undefined) update.active = patch.active;
    await policy.update(update);
    return policy;
  }

  async updateProviderRuntime(
    providerId: string,
    patch: Partial<{ defaultMode: string; providerStatus: string; isActive: boolean; description: string }>,
  ): Promise<DataProviderModel | null> {
    const provider = await this.dataProviderModel.findByPk(providerId);
    if (!provider) return null;
    const update: Record<string, unknown> = { updatedAtValue: new Date() };
    if (patch.defaultMode !== undefined) update.defaultMode = patch.defaultMode;
    if (patch.providerStatus !== undefined) update.providerStatus = patch.providerStatus;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    if (patch.description !== undefined) update.description = patch.description;
    await provider.update(update);
    return provider;
  }

  countRequests(input: { providerId: string; customerId?: string; from: Date; to?: Date; statuses?: string[] }): Promise<number> {
    const where: Record<string, unknown> = { providerId: input.providerId, requestedAt: { [Op.gte]: input.from } };
    if (input.to) where.requestedAt = { [Op.gte]: input.from, [Op.lt]: input.to };
    if (input.customerId) where.customerId = input.customerId;
    if (input.statuses?.length) where.responseStatus = { [Op.in]: input.statuses };
    return this.dataProviderRequestModel.count({ where });
  }

  listIdempotencyAuditRequests(input: { tenantId?: string; from: Date; limit?: number }): Promise<DataProviderRequestModel[]> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from }, idempotencyKey: { [Op.ne]: null } };
    if (input.tenantId) where.tenantId = input.tenantId;
    return this.dataProviderRequestModel.findAll({ where, order: [['requested_at', 'DESC']], limit: input.limit ?? 10000 });
  }

  findCostPolicy(providerId: string, queryType: string): Promise<ExternalProviderCostPolicyModel | null> {
    return this.costPolicyModel.findOne({ where: { providerId, queryType, active: true } });
  }

  findCustomerConsent(tenantId: string, customerId: string, purposeCodes: string[]): Promise<CustomerConsentModel | null> {
    return this.customerConsentModel.findOne({
      where: { tenantId, customerId, granted: true, revokedAt: null, purposeCode: { [Op.in]: purposeCodes } },
      order: [['granted_at', 'DESC']],
    });
  }

  findCustomerConsentByIdAndTenant(tenantId: string, consentId: string): Promise<CustomerConsentModel | null> {
    return this.customerConsentModel.findOne({ where: { tenantId, id: consentId } });
  }

  listCustomerConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.customerConsentModel.findAll({
      where: { tenantId, customerId },
      order: [['granted_at', 'DESC']],
      limit: 100,
    });
  }

  async revokeCustomerConsent(tenantId: string, consentId: string, now: Date): Promise<CustomerConsentModel | null> {
    const consent = await this.customerConsentModel.findOne({ where: { tenantId, id: consentId } });
    if (!consent) return null;
    await consent.update({ granted: false, revokedAt: now, updatedAtValue: now } as Record<string, unknown>);
    return consent;
  }

  async createCustomerConsent(input: {
    tenantId: string;
    customerId: string;
    purposeCode: string;
    channel: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprintSnapshot?: string;
    now: Date;
  }): Promise<CustomerConsentModel> {
    return this.customerConsentModel.create({
      tenantId: input.tenantId,
      customerId: input.customerId,
      consentDocumentId: null,
      purposeCode: input.purposeCode,
      granted: true,
      grantedAt: input.now,
      revokedAt: null,
      channel: input.channel,
      sessionId: input.sessionId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceFingerprintSnapshot: input.deviceFingerprintSnapshot ?? null,
      evidenceSnapshotUrl: null,
      createdAtValue: input.now,
      updatedAtValue: input.now,
    } as Record<string, unknown>);
  }

  createProviderRequest(
    input: {
      tenantId: string;
      providerId: string;
      customerId?: string;
      consentId?: string;
      requestType: string;
      purposeCode: string;
      decisionStage: string;
      modeUsed: string;
      requestPayloadHash: string;
      idempotencyKey?: string;
      responseStatus: string;
      responseCode?: string;
      estimatedCostAmount?: string;
      actualCostAmount?: string;
      currency?: string;
      requestedByUserId?: string;
      approvedByAdminId?: string;
      approvalStatus?: string;
      errorMessageSafe?: string;
      metadataJson?: Record<string, unknown>;
      cachedFromRequestId?: string;
      retryOfRequestId?: string;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<DataProviderRequestModel> {
    return this.dataProviderRequestModel.create(
      {
        tenantId: input.tenantId,
        providerId: input.providerId,
        customerId: input.customerId ?? null,
        consentId: input.consentId ?? null,
        riskAssessmentRunId: null,
        requestType: input.requestType,
        providerRequestRef: null,
        requestPayloadHash: input.requestPayloadHash,
        idempotencyKey: input.idempotencyKey ?? null,
        responseStatus: input.responseStatus,
        responseCode: input.responseCode ?? null,
        purposeCode: input.purposeCode,
        decisionStage: input.decisionStage,
        modeUsed: input.modeUsed,
        estimatedCostAmount: input.estimatedCostAmount ?? null,
        actualCostAmount: input.actualCostAmount ?? null,
        currency: input.currency ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        approvedByAdminId: input.approvedByAdminId ?? null,
        approvalStatus: input.approvalStatus ?? null,
        errorMessageSafe: input.errorMessageSafe ?? null,
        metadataJson: input.metadataJson ?? null,
        cachedFromRequestId: input.cachedFromRequestId ?? null,
        retryOfRequestId: input.retryOfRequestId ?? null,
        latencyMs: null,
        requestedAt: input.now,
        respondedAt: null,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }

  updateProviderRequest(
    request: DataProviderRequestModel,
    patch: {
      responseStatus: string;
      responseCode?: string;
      latencyMs?: number;
      respondedAt?: Date;
      providerRequestRef?: string;
      actualCostAmount?: string;
      errorMessageSafe?: string;
      metadataJson?: Record<string, unknown>;
    },
    options?: QueryOptions,
  ): Promise<DataProviderRequestModel> {
    return request.update(
      {
        responseStatus: patch.responseStatus,
        responseCode: patch.responseCode ?? request.responseCode,
        latencyMs: patch.latencyMs ?? request.latencyMs,
        respondedAt: patch.respondedAt ?? request.respondedAt,
        providerRequestRef: patch.providerRequestRef ?? request.providerRequestRef,
        actualCostAmount: patch.actualCostAmount ?? request.actualCostAmount,
        errorMessageSafe: patch.errorMessageSafe ?? request.errorMessageSafe,
        metadataJson: patch.metadataJson ?? request.metadataJson,
      },
      options,
    );
  }

  createProviderResponse(
    input: {
      tenantId: string;
      providerRequestId: string;
      redactedPayloadJson: Record<string, unknown>;
      normalizedPayloadJson: Record<string, unknown>;
      responseHash: string;
      providerStatusCode?: number;
      providerReference?: string;
      containsSensitiveData: boolean;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<DataProviderResponseModel> {
    return this.dataProviderResponseModel.create(
      {
        tenantId: input.tenantId,
        providerRequestId: input.providerRequestId,
        payloadStorageStrategy: 'inline_redacted',
        responsePayloadJson: null,
        redactedPayloadJson: input.redactedPayloadJson,
        rawPayloadS3Key: null,
        responseHash: input.responseHash,
        providerStatusCode: input.providerStatusCode ?? null,
        providerReference: input.providerReference ?? null,
        normalizedPayloadJson: input.normalizedPayloadJson,
        containsSensitiveData: input.containsSensitiveData,
        retentionPolicyId: null,
        retentionUntil: null,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }

  async createObservations(
    input: {
      tenantId: string;
      customerId: string;
      providerId: string;
      requestId: string;
      observations: NormalizedExternalObservation[];
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<void> {
    for (const observation of input.observations) {
      await this.customerObservationModel.create(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: null,
          deviceId: null,
          observationCode: observation.observationKey,
          valueText: observation.valueType === 'STRING' ? (observation.valueString ?? null) : null,
          valueNumber:
            observation.valueType === 'NUMBER' && typeof observation.valueNumber === 'number' ? observation.valueNumber.toFixed(4) : null,
          valueBoolean: observation.valueType === 'BOOLEAN' ? (observation.valueBoolean ?? null) : null,
          valueJson: observation.valueType === 'JSON' ? (observation.valueJson ?? null) : null,
          sourceType: 'external_provider',
          sourceProviderId: input.providerId,
          evidenceId: null,
          confidenceScore: typeof observation.confidenceScore === 'number' ? (observation.confidenceScore * 100).toFixed(2) : null,
          verificationStatus: observation.verified
            ? 'verified'
            : observation.manualReviewRequired
              ? 'manual_review_required'
              : 'unverified',
          capturedAt: input.now,
          validFrom: input.now,
          validUntil: null,
          derivationMethod: `external_provider_request:${input.requestId}`,
          derivationVersion: 'external-data-v1',
          createdAtValue: input.now,
        } as Record<string, unknown>,
        options,
      );
    }
  }

  createFeatureSnapshot(
    input: {
      tenantId: string;
      customerId: string;
      providerCode: string;
      requestId: string;
      featuresJson: Record<string, unknown>;
      missingFeaturesJson: Record<string, unknown>;
      integrityHash: string;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<FeatureSnapshotModel> {
    return this.featureSnapshotModel.create(
      {
        tenantId: input.tenantId,
        subjectType: 'customer',
        subjectId: input.customerId,
        customerId: input.customerId,
        deviceId: null,
        sessionId: null,
        onboardingFlowId: null,
        riskAssessmentRunId: null,
        snapshotReason: `external_provider_${input.providerCode.toLowerCase()}`,
        triggeringEntityType: 'data_provider_request',
        triggeringEntityId: input.requestId,
        featureSetVersion: 'external-data-v1',
        catalogVersionsJson: {},
        featuresJson: input.featuresJson,
        missingFeaturesJson: input.missingFeaturesJson,
        integrityHash: input.integrityHash,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }

  createHealthLog(input: { providerId: string; health: ProviderHealthResult }): Promise<ProviderHealthLogModel> {
    return this.providerHealthLogModel.create({
      providerId: input.providerId,
      status: input.health.status,
      modeChecked: input.health.mode,
      latencyMs: input.health.latencyMs,
      checkedAt: new Date(input.health.checkedAt),
      errorCode: input.health.errorCode ?? null,
      errorMessageSafe: input.health.errorMessageSafe ?? null,
      metadataJson: { providerCode: input.health.providerCode },
    } as Record<string, unknown>);
  }
}
