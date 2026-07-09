import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  AuthEventModel,
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  CustomerSessionModel,
  DeviceRiskEventModel,
  FormFieldInteractionEventModel,
  IpReputationObservationModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
  OnboardingBehaviorSummaryModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class CustomerTelemetryRepository {
  constructor(
    @InjectModel(CustomerDeviceLinkModel) private readonly customerDeviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(CustomerSessionModel) private readonly customerSessionModel: typeof CustomerSessionModel,
    @InjectModel(DeviceRiskEventModel) private readonly deviceRiskEventModel: typeof DeviceRiskEventModel,
    @InjectModel(SimObservationModel) private readonly simObservationModel: typeof SimObservationModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(IpReputationObservationModel)
    private readonly ipReputationObservationModel: typeof IpReputationObservationModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(FormFieldInteractionEventModel)
    private readonly formFieldInteractionEventModel: typeof FormFieldInteractionEventModel,
    @InjectModel(PermissionEventModel) private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(OnboardingBehaviorSummaryModel)
    private readonly onboardingBehaviorSummaryModel: typeof OnboardingBehaviorSummaryModel,
    @InjectModel(OnDeviceComputationRunModel)
    private readonly onDeviceComputationRunModel: typeof OnDeviceComputationRunModel,
    @InjectModel(OnDeviceMetricValueModel) private readonly onDeviceMetricValueModel: typeof OnDeviceMetricValueModel,
    @InjectModel(CustomerActivitySummaryModel)
    private readonly customerActivitySummaryModel: typeof CustomerActivitySummaryModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
  ) {}

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string): Promise<CustomerDeviceLinkModel | null> {
    return this.customerDeviceLinkModel.findOne({ where: { tenantId, customerId, deviceId } } as FindOptions);
  }

  findCustomerSession(tenantId: string, customerId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({ where: { tenantId, customerId, id: sessionId } } as FindOptions);
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  createFormFieldEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      fieldCode: string;
      interactionType: string;
      usedCopyPaste: boolean | null;
      correctionCount: number | null;
      focusDurationMs: number | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<FormFieldInteractionEventModel> {
    return this.formFieldInteractionEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        fieldCode: values.fieldCode,
        interactionType: values.interactionType,
        usedCopyPaste: values.usedCopyPaste,
        correctionCount: values.correctionCount,
        focusDurationMs: values.focusDurationMs,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createPermissionEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      onboardingFlowId: string | null;
      permissionCode: string;
      granted: boolean;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<PermissionEventModel> {
    return this.permissionEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: values.onboardingFlowId,
        permissionCode: values.permissionCode,
        requestedAt: values.occurredAt,
        granted: values.granted,
        respondedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      eventType: string;
      loginSuccessful: boolean | null;
      failureReasonCode: string | null;
      occurredAt: Date;
      ipAddress: string | null;
    },
    options: RepositoryOptions,
  ): Promise<AuthEventModel> {
    return this.authEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        loginSuccessful: values.loginSuccessful,
        failureReasonCode: values.failureReasonCode,
        occurredAt: values.occurredAt,
        ipAddress: values.ipAddress,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createDeviceRiskEvent(
    values: {
      tenantId: string;
      deviceId: string;
      eventType: string;
      reasonCode: string | null;
      evidence: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceRiskEventModel> {
    return this.deviceRiskEventModel.create(
      {
        tenantId: values.tenantId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        previousRiskStatus: null,
        newRiskStatus: null,
        reasonCode: values.reasonCode,
        supportingEvidenceJson: values.evidence,
        happenedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createSimObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<SimObservationModel> {
    return this.simObservationModel.create(
      {
        tenantId: values.tenantId,
        deviceId: values.deviceId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        phoneNumberHash: typeof values.metadata.phoneNumberHash === 'string' ? values.metadata.phoneNumberHash : null,
        phoneLast4: typeof values.metadata.phoneLast4 === 'string' ? values.metadata.phoneLast4 : null,
        carrierName: typeof values.metadata.carrierName === 'string' ? values.metadata.carrierName : null,
        simType: typeof values.metadata.simType === 'string' ? values.metadata.simType : null,
        simCount: typeof values.metadata.simCount === 'number' ? values.metadata.simCount : null,
        phoneLineTenureMonths: null,
        lastSimSwapAt: null,
        simSwapDaysSince: null,
        sourceType: 'mobile_app',
        confidenceScore: null,
        capturedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createIpReputation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      ipAddress: string | null;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IpReputationObservationModel> {
    return this.ipReputationObservationModel.create(
      {
        tenantId: values.tenantId,
        sessionId: values.sessionId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        providerRequestId: null,
        ipAddress: values.ipAddress,
        isVpn: typeof values.metadata.isVpn === 'boolean' ? values.metadata.isVpn : null,
        isProxy: typeof values.metadata.isProxy === 'boolean' ? values.metadata.isProxy : null,
        isTor: typeof values.metadata.isTor === 'boolean' ? values.metadata.isTor : null,
        countryCode: typeof values.metadata.countryCode === 'string' ? values.metadata.countryCode : null,
        city: typeof values.metadata.city === 'string' ? values.metadata.city : null,
        reputationScore: typeof values.metadata.reputationScore === 'number' ? values.metadata.reputationScore.toFixed(4) : null,
        capturedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

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

  createOnboardingStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingStepEventModel> {
    return this.onboardingStepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.occurredAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payload,
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

  createOnDeviceRun(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionId: string;
      onboardingFlowId: string | null;
      integrityHash: string;
      computedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceComputationRunModel> {
    return this.onDeviceComputationRunModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionId: values.sessionId,
        onboardingFlowId: values.onboardingFlowId,
        consentId: null,
        algorithmCode: 'atlas_on_device_metrics',
        algorithmVersion: 'v1',
        computationStatus: 'received',
        rawContactsStored: false,
        rawSmsStored: false,
        integrityHash: values.integrityHash,
        computedAtDevice: values.computedAt,
        receivedAtServer: new Date(),
        createdAtValue: new Date(),
      },
      { transaction: options.transaction },
    );
  }

  createOnDeviceMetric(
    values: {
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      value: string | number | boolean | Record<string, unknown>;
      confidenceScore: string | null;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceMetricValueModel> {
    return this.onDeviceMetricValueModel.create(
      {
        tenantId: values.tenantId,
        computationRunId: values.computationRunId,
        metricCode: values.metricCode,
        valueText: typeof values.value === 'string' ? values.value : null,
        valueNumber: typeof values.value === 'number' ? values.value.toFixed(4) : null,
        valueBoolean: typeof values.value === 'boolean' ? values.value : null,
        valueJson: typeof values.value === 'object' && !Array.isArray(values.value) ? values.value : null,
        confidenceScore: values.confidenceScore,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
  }

  createBehaviorSummary(
    values: {
      tenantId: string;
      customerId: string;
      onboardingFlowId: string | null;
      formEventCount: number;
      permissionEventCount: number;
      computedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingBehaviorSummaryModel> {
    return this.onboardingBehaviorSummaryModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        onboardingFlowId: values.onboardingFlowId,
        completionTimeSeconds: null,
        interScreenTimingJson: null,
        formErrorRate: null,
        ciCopyPasteDetected: null,
        abandonmentCountPrior: null,
        permissionGrantScore: values.permissionEventCount > 0 ? '1.0000' : null,
        behaviorClusterCode: null,
        botLikelihoodScore: null,
        computationVersion: 'telemetry-batch-v1',
        computedAt: values.computedAt,
        createdAtValue: values.computedAt,
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
