import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, Transaction } from 'sequelize';
import {
  AddressGpsObservationModel,
  AuthEventModel,
  CustomerActionLogModel,
  CustomerActivitySummaryModel,
  CustomerAddressModel,
  CustomerAddressVersionModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  CustomerSessionModel,
  DeviceModel,
  DeviceRiskEventModel,
  DeviceSnapshotModel,
  GlobalDeviceFingerprintModel,
  IpReputationObservationModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../database/models/index.js';
import { toOffset } from '../../common/utils/pagination/pagination.util.js';

type RepositoryOptions = {
  transaction?: Transaction;
};

export type CurrentAddressContext = {
  addressId: string | null;
  addressVersionId: string | null;
};

@Injectable()
export class SessionsRepository {
  constructor(
    @InjectModel(GlobalDeviceFingerprintModel) private readonly globalDeviceModel: typeof GlobalDeviceFingerprintModel,
    @InjectModel(DeviceModel) private readonly deviceModel: typeof DeviceModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly customerDeviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(CustomerSessionModel) private readonly customerSessionModel: typeof CustomerSessionModel,
    @InjectModel(DeviceSnapshotModel) private readonly deviceSnapshotModel: typeof DeviceSnapshotModel,
    @InjectModel(AddressGpsObservationModel) private readonly addressGpsObservationModel: typeof AddressGpsObservationModel,
    @InjectModel(PermissionEventModel) private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(IpReputationObservationModel) private readonly ipReputationObservationModel: typeof IpReputationObservationModel,
    @InjectModel(SimObservationModel) private readonly simObservationModel: typeof SimObservationModel,
    @InjectModel(DeviceRiskEventModel) private readonly deviceRiskEventModel: typeof DeviceRiskEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(CustomerActivitySummaryModel) private readonly customerActivitySummaryModel: typeof CustomerActivitySummaryModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(CustomerAddressModel) private readonly customerAddressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerAddressVersionModel) private readonly customerAddressVersionModel: typeof CustomerAddressVersionModel,
  ) {}

  findGlobalDevice(
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<GlobalDeviceFingerprintModel | null> {
    return this.globalDeviceModel.findOne({
      where: { deviceFingerprint, fingerprintVersion },
      transaction: options.transaction,
    } as FindOptions);
  }

  createGlobalDevice(values: { deviceFingerprint: string; fingerprintVersion: string; now: Date }, options: RepositoryOptions) {
    return this.globalDeviceModel.create(
      {
        deviceFingerprint: values.deviceFingerprint,
        fingerprintVersion: values.fingerprintVersion,
        globalFirstSeenAt: values.now,
        globalLastSeenAt: values.now,
        globalReuseCount: 1,
        globalRiskStatus: 'unknown',
        createdAtValue: values.now,
        updatedAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  async touchGlobalDevice(globalDevice: GlobalDeviceFingerprintModel, now: Date, options: RepositoryOptions): Promise<void> {
    globalDevice.globalLastSeenAt = now;
    globalDevice.globalReuseCount = (globalDevice.globalReuseCount ?? 0) + 1;
    globalDevice.updatedAtValue = now;
    await globalDevice.save({ transaction: options.transaction });
  }

  findDevice(
    tenantId: string,
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<DeviceModel | null> {
    return this.deviceModel.findOne({
      where: { tenantId, deviceFingerprint, fingerprintVersion, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  findDeviceById(tenantId: string, deviceId: string, options: RepositoryOptions = {}): Promise<DeviceModel | null> {
    return this.deviceModel.findOne({
      where: { tenantId, id: deviceId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createDevice(
    values: {
      tenantId: string;
      globalDeviceFingerprintId: string;
      deviceFingerprint: string;
      fingerprintVersion: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceModel> {
    return this.deviceModel.create(
      {
        tenantId: values.tenantId,
        globalDeviceFingerprintId: values.globalDeviceFingerprintId,
        deviceFingerprint: values.deviceFingerprint,
        fingerprintVersion: values.fingerprintVersion,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        tenantReuseCount: 1,
        riskStatus: 'unknown',
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchDevice(device: DeviceModel, now: Date, options: RepositoryOptions): Promise<void> {
    device.lastSeenAt = now;
    device.tenantReuseCount = (device.tenantReuseCount ?? 0) + 1;
    device.updatedAtValue = now;
    await device.save({ transaction: options.transaction });
  }

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string, options: RepositoryOptions) {
    return this.customerDeviceLinkModel.findOne({
      where: { tenantId, customerId, deviceId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createCustomerDeviceLink(values: { tenantId: string; customerId: string; deviceId: string; now: Date }, options: RepositoryOptions) {
    return this.customerDeviceLinkModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        linkStatus: 'active',
        isPrimaryDevice: false,
        trustLevel: 'new',
        firstSeenSessionId: null,
        lastSeenSessionId: null,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchCustomerDeviceLink(link: CustomerDeviceLinkModel, sessionId: string, now: Date, options: RepositoryOptions): Promise<void> {
    link.lastSeenSessionId = sessionId;
    if (link.firstSeenSessionId === null) {
      link.firstSeenSessionId = sessionId;
    }
    link.lastSeenAt = now;
    link.updatedAtValue = now;
    await link.save({ transaction: options.transaction });
  }

  createSession(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionTokenHash: string;
      channel: string;
      authMethod: string;
      ipAddress: string | null;
      userAgent: string | null;
      gpsLat: string | null;
      gpsLng: string | null;
      gpsAccuracyMeters: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerSessionModel> {
    return this.customerSessionModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionTokenHash: values.sessionTokenHash,
        channel: values.channel,
        authMethod: values.authMethod,
        startedAt: values.now,
        endedAt: null,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        sessionStatus: 'active',
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  findSessionById(
    tenantId: string,
    customerId: string,
    sessionId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({
      where: { tenantId, customerId, id: sessionId },
      transaction: options.transaction,
    } as FindOptions);
  }

  findSessionForOperations(tenantId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({ where: { tenantId, id: sessionId } } as FindOptions);
  }

  findLatestActiveSession(tenantId: string, customerId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({
      where: { tenantId, customerId, sessionStatus: 'active' },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  async endSession(session: CustomerSessionModel, endedAt: Date, options: RepositoryOptions): Promise<CustomerSessionModel> {
    session.endedAt = endedAt;
    session.sessionStatus = 'ended';
    return session.save({ transaction: options.transaction });
  }

  createDeviceSnapshot(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionId: string;
      brand: string | null;
      model: string | null;
      osFamily: string | null;
      osVersion: string | null;
      appVersion: string | null;
      isRooted: boolean | null;
      isEmulator: boolean | null;
      vpnDetected: boolean | null;
      now: Date;
    },
    options: RepositoryOptions,
  ) {
    return this.deviceSnapshotModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionId: values.sessionId,
        brand: values.brand,
        model: values.model,
        osFamily: values.osFamily,
        osVersion: values.osVersion,
        appVersion: values.appVersion,
        isRooted: values.isRooted,
        isEmulator: values.isEmulator,
        vpnDetected: values.vpnDetected,
        capturedAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  async findCurrentAddressContext(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CurrentAddressContext> {
    const address = await this.customerAddressModel.findOne({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);

    if (!address) return { addressId: null, addressVersionId: null };

    if (address.currentVersionId) {
      return { addressId: String(address.id), addressVersionId: String(address.currentVersionId) };
    }

    const version = await this.customerAddressVersionModel.findOne({
      where: { tenantId, customerAddressId: String(address.id), validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);

    return { addressId: String(address.id), addressVersionId: version ? String(version.id) : null };
  }

  createGpsObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      customerAddressId: string | null;
      addressVersionId: string | null;
      gpsLat: string;
      gpsLng: string;
      gpsAccuracyMeters: string | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<AddressGpsObservationModel> {
    return this.addressGpsObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        customerAddressId: values.customerAddressId,
        addressVersionId: values.addressVersionId,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        matchScoreAgainstDeclaredAddress: null,
        distanceToDeclaredMeters: null,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
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
      decidedAt: Date;
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
        requestedAt: values.decidedAt,
        granted: values.granted,
        respondedAt: values.decidedAt,
        createdAtValue: values.decidedAt,
      },
      { transaction: options.transaction },
    );
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
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

  createIpReputation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      ipAddress: string | null;
      isVpn: boolean | null;
      isProxy: boolean | null;
      isTor: boolean | null;
      countryCode: string | null;
      city: string | null;
      reputationScore: string | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IpReputationObservationModel> {
    return this.ipReputationObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        providerRequestId: null,
        ipAddress: values.ipAddress,
        isVpn: values.isVpn,
        isProxy: values.isProxy,
        isTor: values.isTor,
        countryCode: values.countryCode,
        city: values.city,
        reputationScore: values.reputationScore,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
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
      phoneNumberHash: string | null;
      phoneLast4: string | null;
      carrierName: string | null;
      simType: string | null;
      simCount: number | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<SimObservationModel> {
    return this.simObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        phoneNumberHash: values.phoneNumberHash,
        phoneLast4: values.phoneLast4,
        carrierName: values.carrierName,
        simType: values.simType,
        simCount: values.simCount,
        phoneLineTenureMonths: null,
        lastSimSwapAt: null,
        simSwapDaysSince: null,
        sourceType: 'mobile_app',
        confidenceScore: null,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDeviceRiskEvent(
    values: {
      tenantId: string;
      deviceId: string;
      eventType: string;
      reasonCode: string;
      evidence: Record<string, unknown>;
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

  createCustomerAction(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
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
      deviceId: string | null;
      observationCode: string;
      valueBoolean: boolean | null;
      payload: Record<string, unknown> | null;
      sourceType: string;
      capturedAt: Date;
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
        valueBoolean: values.valueBoolean,
        valueJson: values.payload,
        sourceType: values.sourceType,
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'observed',
        capturedAt: values.capturedAt,
        validFrom: values.capturedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
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

  findCustomerSessions(input: { tenantId: string; customerId: string; page: number; limit: number }) {
    return this.customerSessionModel.findAndCountAll({
      where: { tenantId: input.tenantId, customerId: input.customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: input.limit,
      offset: toOffset({ page: input.page, limit: input.limit }),
    } as FindAndCountOptions);
  }

  findLatestDeviceSnapshot(tenantId: string, sessionId: string): Promise<DeviceSnapshotModel | null> {
    return this.deviceSnapshotModel.findOne({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findLatestGpsObservation(tenantId: string, sessionId: string): Promise<AddressGpsObservationModel | null> {
    return this.addressGpsObservationModel.findOne({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findSessionPermissionEvents(tenantId: string, sessionId: string, limit = 20): Promise<PermissionEventModel[]> {
    return this.permissionEventModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['respondedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionGpsObservations(tenantId: string, sessionId: string, limit = 30): Promise<AddressGpsObservationModel[]> {
    return this.addressGpsObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionDeviceSnapshots(tenantId: string, sessionId: string, limit = 10): Promise<DeviceSnapshotModel[]> {
    return this.deviceSnapshotModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionAuthEvents(tenantId: string, sessionId: string, limit = 20): Promise<AuthEventModel[]> {
    return this.authEventModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionIpReputation(tenantId: string, sessionId: string, limit = 10): Promise<IpReputationObservationModel[]> {
    return this.ipReputationObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionSimObservations(tenantId: string, sessionId: string, limit = 10): Promise<SimObservationModel[]> {
    return this.simObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findDeviceRiskEvents(tenantId: string, deviceId: string, limit = 20): Promise<DeviceRiskEventModel[]> {
    return this.deviceRiskEventModel.findAll({
      where: { tenantId, deviceId },
      order: [
        ['happenedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionCustomerActions(tenantId: string, sessionId: string, limit = 30): Promise<CustomerActionLogModel[]> {
    return this.customerActionLogModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  findSessionCustomerObservations(tenantId: string, sessionId: string, limit = 30): Promise<CustomerObservationModel[]> {
    return this.customerObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
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
