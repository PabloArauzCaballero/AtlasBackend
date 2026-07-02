import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { EndSessionResponseDto, HeartbeatResponseDto, SessionGpsResult } from './sessions.dtos.js';
import { toStartSessionResponse } from './sessions.mapper.js';
import { EndSessionDto, SessionHeartbeatDto, StartSessionDto } from './sessions.schemas.js';
import { SessionsRepository } from './sessions.repository.js';

const INTERNAL_ROLES = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'];

type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

type DeviceRiskFlag = {
  eventType: string;
  reasonCode: string;
  evidence: Record<string, unknown>;
};

function assertInternalAccess(user: AuthenticatedUser): void {
  if (!INTERNAL_ROLES.includes(user.role)) {
    throw new ForbiddenException('Este endpoint es interno.');
  }
}

function decimal(value: number | undefined, digits: number): string | null {
  if (value === undefined) return null;
  return value.toFixed(digits);
}

function toDate(value: string | undefined, fallback: Date): Date {
  return value ? new Date(value) : fallback;
}

function hasLocationPermission(input: {
  locationPermissionGranted?: boolean;
  permissions?: Array<{ permissionCode: string; granted: boolean }>;
  permissionChanges?: Array<{ permissionCode: string; granted: boolean }>;
}): boolean {
  if (input.locationPermissionGranted === true) return true;
  const permissions = input.permissions ?? input.permissionChanges ?? [];
  return permissions.some((permission) => permission.permissionCode === 'location' && permission.granted === true);
}

function riskFlagsFromSnapshot(
  snapshot: { isRooted?: boolean; isEmulator?: boolean; vpnDetected?: boolean } | undefined,
  source: string,
): DeviceRiskFlag[] {
  if (!snapshot) return [];
  const flags: DeviceRiskFlag[] = [];
  if (snapshot.isRooted === true) {
    flags.push({ eventType: 'device_root_detected', reasonCode: 'rooted_device', evidence: { source, isRooted: true } });
  }
  if (snapshot.isEmulator === true) {
    flags.push({ eventType: 'device_emulator_detected', reasonCode: 'emulator_device', evidence: { source, isEmulator: true } });
  }
  if (snapshot.vpnDetected === true) {
    flags.push({ eventType: 'device_vpn_detected', reasonCode: 'vpn_detected', evidence: { source, vpnDetected: true } });
  }
  return flags;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async startSession(input: { customerId: string; body: StartSessionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    if (!input.context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.context.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    if (customer.lifecycleStatus === 'blocked') throw new UnprocessableEntityException('CUSTOMER_BLOCKED');

    const now = new Date();
    const canStoreGps = input.body.gpsObservation ? hasLocationPermission(input.body) : false;
    const sessionTokenHash =
      input.body.sessionTokenHash ??
      sha256Hex(`${input.customerId}:${input.body.device.deviceFingerprintHash}:${input.context.idempotencyKey}:${now.toISOString()}`);

    return this.sequelize.transaction(async (transaction) => {
      const existingGlobalDevice = await this.sessionsRepository.findGlobalDevice(
        input.body.device.deviceFingerprintHash,
        input.body.device.fingerprintVersion,
        { transaction },
      );
      const globalDevice =
        existingGlobalDevice ??
        (await this.sessionsRepository.createGlobalDevice(
          {
            deviceFingerprint: input.body.device.deviceFingerprintHash,
            fingerprintVersion: input.body.device.fingerprintVersion,
            now,
          },
          { transaction },
        ));
      if (existingGlobalDevice) await this.sessionsRepository.touchGlobalDevice(existingGlobalDevice, now, { transaction });

      const existingDevice = await this.sessionsRepository.findDevice(
        input.context.tenantId,
        input.body.device.deviceFingerprintHash,
        input.body.device.fingerprintVersion,
        { transaction },
      );
      const device =
        existingDevice ??
        (await this.sessionsRepository.createDevice(
          {
            tenantId: input.context.tenantId,
            globalDeviceFingerprintId: String(globalDevice.id),
            deviceFingerprint: input.body.device.deviceFingerprintHash,
            fingerprintVersion: input.body.device.fingerprintVersion,
            now,
          },
          { transaction },
        ));
      if (existingDevice) await this.sessionsRepository.touchDevice(existingDevice, now, { transaction });

      const existingLink = await this.sessionsRepository.findCustomerDeviceLink(
        input.context.tenantId,
        input.customerId,
        String(device.id),
        { transaction },
      );
      const link =
        existingLink ??
        (await this.sessionsRepository.createCustomerDeviceLink(
          { tenantId: input.context.tenantId, customerId: input.customerId, deviceId: String(device.id), now },
          { transaction },
        ));

      const session = await this.sessionsRepository.createSession(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          deviceId: String(device.id),
          sessionTokenHash,
          channel: input.body.device.channel,
          authMethod: input.body.authMethod,
          ipAddress: input.context.ipAddress,
          userAgent: input.body.device.userAgent ?? input.context.userAgent,
          gpsLat: canStoreGps ? decimal(input.body.gpsObservation?.lat, 7) : null,
          gpsLng: canStoreGps ? decimal(input.body.gpsObservation?.lng, 7) : null,
          gpsAccuracyMeters: canStoreGps ? decimal(input.body.gpsObservation?.accuracyMeters, 2) : null,
          now,
        },
        { transaction },
      );
      await this.sessionsRepository.touchCustomerDeviceLink(link, String(session.id), now, { transaction });

      if (input.body.device.snapshot) {
        await this.sessionsRepository.createDeviceSnapshot(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            deviceId: String(device.id),
            sessionId: String(session.id),
            brand: input.body.device.snapshot.brand ?? null,
            model: input.body.device.snapshot.model ?? null,
            osFamily: input.body.device.snapshot.osFamily ?? null,
            osVersion: input.body.device.snapshot.osVersion ?? null,
            appVersion: input.body.device.snapshot.appVersion ?? null,
            isRooted: input.body.device.snapshot.isRooted ?? null,
            isEmulator: input.body.device.snapshot.isEmulator ?? null,
            vpnDetected: input.body.device.snapshot.vpnDetected ?? null,
            now,
          },
          { transaction },
        );
      }

      const flow = await this.sessionsRepository.findLatestOnboardingFlow(input.context.tenantId, input.customerId, { transaction });
      for (const permission of input.body.permissions) {
        await this.sessionsRepository.createPermissionEvent(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: String(session.id),
            onboardingFlowId: flow ? String(flow.id) : null,
            permissionCode: permission.permissionCode,
            granted: permission.granted,
            decidedAt: toDate(permission.decidedAt, now),
          },
          { transaction },
        );
      }

      const gpsResult = await this.createSessionGpsIfAllowed({
        tenantId: input.context.tenantId,
        customerId: input.customerId,
        sessionId: String(session.id),
        gpsObservation: input.body.gpsObservation,
        canStoreGps,
        defaultCapturedAt: now,
        transaction,
      });

      if (input.body.simObservation) {
        await this.sessionsRepository.createSimObservation(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: String(session.id),
            deviceId: String(device.id),
            phoneNumberHash: input.body.simObservation.phoneNumberHash ?? null,
            phoneLast4: input.body.simObservation.phoneLast4 ?? null,
            carrierName: input.body.simObservation.carrierName ?? null,
            simType: input.body.simObservation.simType ?? null,
            simCount: input.body.simObservation.simCount ?? null,
            capturedAt: now,
          },
          { transaction },
        );
      }

      if (input.body.ipReputation) {
        await this.sessionsRepository.createIpReputation(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: String(session.id),
            deviceId: String(device.id),
            ipAddress: input.context.ipAddress,
            isVpn: input.body.ipReputation.isVpn ?? null,
            isProxy: input.body.ipReputation.isProxy ?? null,
            isTor: input.body.ipReputation.isTor ?? null,
            countryCode: input.body.ipReputation.countryCode ?? null,
            city: input.body.ipReputation.city ?? null,
            reputationScore: decimal(input.body.ipReputation.reputationScore, 2),
            capturedAt: now,
          },
          { transaction },
        );
      }

      for (const riskFlag of riskFlagsFromSnapshot(input.body.device.snapshot, 'sessions_start')) {
        await this.sessionsRepository.createDeviceRiskEvent(
          {
            tenantId: input.context.tenantId,
            deviceId: String(device.id),
            eventType: riskFlag.eventType,
            reasonCode: riskFlag.reasonCode,
            evidence: riskFlag.evidence,
            occurredAt: now,
          },
          { transaction },
        );
      }

      await this.sessionsRepository.createAuthEvent(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: String(session.id),
          deviceId: String(device.id),
          eventType: 'session_started',
          loginSuccessful: true,
          failureReasonCode: null,
          occurredAt: now,
          ipAddress: input.context.ipAddress,
        },
        { transaction },
      );
      await this.sessionsRepository.createCustomerAction(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: String(session.id),
          deviceId: String(device.id),
          eventName: 'session_started',
          screenName: 'session_start',
          payload: { channel: input.body.device.channel, idempotencyKeyHash: sha256Hex(input.context.idempotencyKey ?? '') },
          occurredAt: now,
        },
        { transaction },
      );
      await this.sessionsRepository.createCustomerObservation(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: String(session.id),
          deviceId: String(device.id),
          observationCode: gpsResult.gpsObservationCreated ? 'session_gps_observed' : 'session_started_without_gps',
          valueBoolean: gpsResult.gpsObservationCreated,
          payload: { gpsObservationId: gpsResult.gpsObservationId, skippedReason: gpsResult.gpsObservationSkippedReason },
          sourceType: 'session_start',
          capturedAt: now,
        },
        { transaction },
      );
      if (flow) {
        await this.sessionsRepository.createOnboardingStepEvent(
          {
            tenantId: input.context.tenantId,
            onboardingFlowId: String(flow.id),
            stepCode: 'session_started',
            eventType: 'session',
            payload: { sessionId: String(session.id), deviceId: String(device.id), gpsObservationCreated: gpsResult.gpsObservationCreated },
            occurredAt: now,
          },
          { transaction },
        );
      }
      await this.sessionsRepository.upsertActivitySummary(
        { tenantId: input.context.tenantId, customerId: input.customerId, deviceId: String(device.id), now, incrementSessionCount: true },
        { transaction },
      );
      await this.sessionsRepository.createAudit(
        {
          tenantId: input.context.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_session.start',
          targetType: 'session',
          targetId: String(session.id),
          ipAddress: input.context.ipAddress,
          userAgent: input.body.device.userAgent ?? input.context.userAgent,
          payload: { customerId: input.customerId, deviceId: String(device.id), gpsObservationCreated: gpsResult.gpsObservationCreated },
          occurredAt: now,
        },
        { transaction },
      );

      return toStartSessionResponse({
        customerId: input.customerId,
        session,
        device,
        link,
        gps: gpsResult,
        nextStep: customer.lifecycleStatus === 'registered' ? 'continue_onboarding' : 'continue',
      });
    });
  }

  async heartbeat(input: {
    customerId: string;
    sessionId: string;
    body: SessionHeartbeatDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }): Promise<HeartbeatResponseDto> {
    if (!input.context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.context.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const capturedAt = toDate(input.body.capturedAt, new Date());
    return this.sequelize.transaction(async (transaction) => {
      const session = await this.sessionsRepository.findSessionById(input.context.tenantId, input.customerId, input.sessionId, {
        transaction,
      });
      if (!session) throw new NotFoundException('Sesión no encontrada.');
      if (session.sessionStatus !== 'active') throw new UnprocessableEntityException('SESSION_NOT_ACTIVE');
      if (session.deviceId && String(session.deviceId) !== input.body.deviceId)
        throw new ForbiddenException('El dispositivo no corresponde a la sesión.');

      const device = await this.sessionsRepository.findDeviceById(input.context.tenantId, input.body.deviceId, { transaction });
      if (!device) throw new NotFoundException('Dispositivo no encontrado.');
      const link = await this.sessionsRepository.findCustomerDeviceLink(input.context.tenantId, input.customerId, input.body.deviceId, {
        transaction,
      });
      if (!link && input.currentUser.role === 'customer') throw new ForbiddenException('El dispositivo no está vinculado al cliente.');

      await this.sessionsRepository.touchDevice(device, capturedAt, { transaction });
      if (link) await this.sessionsRepository.touchCustomerDeviceLink(link, input.sessionId, capturedAt, { transaction });

      const flow = await this.sessionsRepository.findLatestOnboardingFlow(input.context.tenantId, input.customerId, { transaction });
      for (const permission of input.body.permissionChanges) {
        await this.sessionsRepository.createPermissionEvent(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: input.sessionId,
            onboardingFlowId: flow ? String(flow.id) : null,
            permissionCode: permission.permissionCode,
            granted: permission.granted,
            decidedAt: toDate(permission.decidedAt, capturedAt),
          },
          { transaction },
        );
      }

      if (input.body.deviceSnapshot) {
        await this.sessionsRepository.createDeviceSnapshot(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            deviceId: input.body.deviceId,
            sessionId: input.sessionId,
            brand: input.body.deviceSnapshot.brand ?? null,
            model: input.body.deviceSnapshot.model ?? null,
            osFamily: input.body.deviceSnapshot.osFamily ?? null,
            osVersion: input.body.deviceSnapshot.osVersion ?? null,
            appVersion: input.body.deviceSnapshot.appVersion ?? null,
            isRooted: input.body.deviceSnapshot.isRooted ?? null,
            isEmulator: input.body.deviceSnapshot.isEmulator ?? null,
            vpnDetected: input.body.deviceSnapshot.vpnDetected ?? null,
            now: capturedAt,
          },
          { transaction },
        );
      }

      const gpsResult = await this.createSessionGpsIfAllowed({
        tenantId: input.context.tenantId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        gpsObservation: input.body.gpsObservation,
        canStoreGps: input.body.gpsObservation ? hasLocationPermission(input.body) : false,
        defaultCapturedAt: capturedAt,
        transaction,
      });

      if (input.body.simObservation) {
        await this.sessionsRepository.createSimObservation(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: input.sessionId,
            deviceId: input.body.deviceId,
            phoneNumberHash: input.body.simObservation.phoneNumberHash ?? null,
            phoneLast4: input.body.simObservation.phoneLast4 ?? null,
            carrierName: input.body.simObservation.carrierName ?? null,
            simType: input.body.simObservation.simType ?? null,
            simCount: input.body.simObservation.simCount ?? null,
            capturedAt,
          },
          { transaction },
        );
      }

      if (input.body.ipReputation) {
        await this.sessionsRepository.createIpReputation(
          {
            tenantId: input.context.tenantId,
            customerId: input.customerId,
            sessionId: input.sessionId,
            deviceId: input.body.deviceId,
            ipAddress: input.context.ipAddress,
            isVpn: input.body.ipReputation.isVpn ?? null,
            isProxy: input.body.ipReputation.isProxy ?? null,
            isTor: input.body.ipReputation.isTor ?? null,
            countryCode: input.body.ipReputation.countryCode ?? null,
            city: input.body.ipReputation.city ?? null,
            reputationScore: decimal(input.body.ipReputation.reputationScore, 2),
            capturedAt,
          },
          { transaction },
        );
      }

      let riskSignalsCreated = 0;
      for (const riskFlag of riskFlagsFromSnapshot(input.body.deviceSnapshot, 'sessions_heartbeat')) {
        riskSignalsCreated += 1;
        await this.sessionsRepository.createDeviceRiskEvent(
          {
            tenantId: input.context.tenantId,
            deviceId: input.body.deviceId,
            eventType: riskFlag.eventType,
            reasonCode: riskFlag.reasonCode,
            evidence: riskFlag.evidence,
            occurredAt: capturedAt,
          },
          { transaction },
        );
      }

      await this.sessionsRepository.createCustomerAction(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId: input.body.deviceId,
          eventName: 'session_heartbeat',
          screenName: null,
          payload: { clientHeartbeatId: input.body.clientHeartbeatId, gpsObservationCreated: gpsResult.gpsObservationCreated },
          occurredAt: capturedAt,
        },
        { transaction },
      );
      await this.sessionsRepository.createCustomerObservation(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId: input.body.deviceId,
          observationCode: gpsResult.gpsObservationCreated ? 'heartbeat_gps_observed' : 'heartbeat_without_gps',
          valueBoolean: gpsResult.gpsObservationCreated,
          payload: {
            clientHeartbeatId: input.body.clientHeartbeatId,
            gpsObservationId: gpsResult.gpsObservationId,
            skippedReason: gpsResult.gpsObservationSkippedReason,
          },
          sourceType: 'session_heartbeat',
          capturedAt,
        },
        { transaction },
      );
      await this.sessionsRepository.upsertActivitySummary(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          deviceId: input.body.deviceId,
          now: capturedAt,
          incrementSessionCount: false,
        },
        { transaction },
      );
      await this.sessionsRepository.createAudit(
        {
          tenantId: input.context.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_session.heartbeat',
          targetType: 'session',
          targetId: input.sessionId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
          payload: {
            customerId: input.customerId,
            clientHeartbeatId: input.body.clientHeartbeatId,
            riskSignalsCreated,
            gpsObservationCreated: gpsResult.gpsObservationCreated,
          },
          occurredAt: capturedAt,
        },
        { transaction },
      );

      return {
        sessionId: input.sessionId,
        status: 'accepted',
        gpsObservationCreated: gpsResult.gpsObservationCreated,
        gpsObservationId: gpsResult.gpsObservationId,
        gpsObservationSkippedReason: gpsResult.gpsObservationSkippedReason,
        riskSignalsCreated,
      };
    });
  }

  async endSession(input: {
    customerId: string;
    sessionId: string;
    body: EndSessionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }): Promise<EndSessionResponseDto> {
    if (!input.context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const endedAt = toDate(input.body.endedAt, new Date());
    return this.sequelize.transaction(async (transaction) => {
      const session = await this.sessionsRepository.findSessionById(input.context.tenantId, input.customerId, input.sessionId, {
        transaction,
      });
      if (!session) throw new NotFoundException('Sesión no encontrada.');
      if (session.sessionStatus !== 'active') throw new UnprocessableEntityException('SESSION_NOT_ACTIVE');
      if (input.body.deviceId && session.deviceId && String(session.deviceId) !== input.body.deviceId) {
        throw new ForbiddenException('El dispositivo no corresponde a la sesión.');
      }
      const deviceId = input.body.deviceId ?? (session.deviceId ? String(session.deviceId) : null);
      const ended = await this.sessionsRepository.endSession(session, endedAt, { transaction });
      await this.sessionsRepository.createAuthEvent(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId,
          eventType: 'session_ended',
          loginSuccessful: null,
          failureReasonCode: null,
          occurredAt: endedAt,
          ipAddress: input.context.ipAddress,
        },
        { transaction },
      );
      await this.sessionsRepository.createCustomerAction(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId,
          eventName: 'session_ended',
          screenName: null,
          payload: { reasonCode: input.body.reasonCode },
          occurredAt: endedAt,
        },
        { transaction },
      );
      if (deviceId) {
        await this.sessionsRepository.upsertActivitySummary(
          { tenantId: input.context.tenantId, customerId: input.customerId, deviceId, now: endedAt, incrementSessionCount: false },
          { transaction },
        );
      }
      await this.sessionsRepository.createAudit(
        {
          tenantId: input.context.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_session.end',
          targetType: 'session',
          targetId: input.sessionId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
          payload: { customerId: input.customerId, reasonCode: input.body.reasonCode },
          occurredAt: endedAt,
        },
        { transaction },
      );

      return {
        sessionId: String(ended.id),
        sessionStatus: ended.sessionStatus ?? 'ended',
        endedAt: endedAt.toISOString(),
      };
    });
  }

  async getSessionState(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    const session = await this.sessionsRepository.findLatestActiveSession(input.tenantId, input.customerId);
    if (!session) {
      return {
        customerId: input.customerId,
        activeSession: null,
        device: null,
        location: { lastGpsObservedAt: null, hasRecentGps: false },
      };
    }
    const deviceId = session.deviceId ? String(session.deviceId) : null;
    const device = deviceId ? await this.sessionsRepository.findDeviceById(input.tenantId, deviceId) : null;
    const link = deviceId ? await this.sessionsRepository.findCustomerDeviceLink(input.tenantId, input.customerId, deviceId, {}) : null;
    const latestGps = await this.sessionsRepository.findLatestGpsObservation(input.tenantId, String(session.id));
    const latestSnapshot = await this.sessionsRepository.findLatestDeviceSnapshot(input.tenantId, String(session.id));

    return {
      customerId: input.customerId,
      activeSession: {
        sessionId: String(session.id),
        status: session.sessionStatus ?? 'active',
        startedAt: session.startedAt?.toISOString() ?? null,
      },
      device: device
        ? {
            deviceId: String(device.id),
            trustLevel: link?.trustLevel ?? null,
            riskStatus: device.riskStatus ?? null,
            latestSnapshot: latestSnapshot
              ? {
                  capturedAt: latestSnapshot.capturedAt?.toISOString() ?? null,
                  appVersion: latestSnapshot.appVersion,
                  vpnDetected: latestSnapshot.vpnDetected,
                  isRooted: latestSnapshot.isRooted,
                  isEmulator: latestSnapshot.isEmulator,
                }
              : null,
          }
        : null,
      location: {
        lastGpsObservedAt: latestGps?.capturedAt?.toISOString() ?? null,
        hasRecentGps: latestGps?.capturedAt ? Date.now() - latestGps.capturedAt.getTime() <= 30 * 60_000 : false,
      },
    };
  }

  async getOperationsSessionSummary(input: { tenantId: string; sessionId: string; currentUser: AuthenticatedUser }) {
    assertInternalAccess(input.currentUser);
    const session = await this.sessionsRepository.findSessionForOperations(input.tenantId, input.sessionId);
    if (!session) throw new NotFoundException('Sesión no encontrada.');

    const customerId = session.customerId ? String(session.customerId) : null;
    const deviceId = session.deviceId ? String(session.deviceId) : null;
    const customer = customerId ? await this.customersRepository.findById(input.tenantId, customerId) : null;
    const device = deviceId ? await this.sessionsRepository.findDeviceById(input.tenantId, deviceId) : null;
    const [
      gpsObservations,
      deviceSnapshots,
      permissions,
      authEvents,
      ipReputation,
      simObservations,
      riskEvents,
      actions,
      observations,
      auditTrail,
    ] = await Promise.all([
      this.sessionsRepository.findSessionGpsObservations(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionDeviceSnapshots(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionPermissionEvents(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionAuthEvents(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionIpReputation(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionSimObservations(input.tenantId, input.sessionId),
      deviceId ? this.sessionsRepository.findDeviceRiskEvents(input.tenantId, deviceId) : Promise.resolve([]),
      this.sessionsRepository.findSessionCustomerActions(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionCustomerObservations(input.tenantId, input.sessionId),
      this.sessionsRepository.findSessionAudits(input.tenantId, input.sessionId),
    ]);

    return {
      session: {
        sessionId: String(session.id),
        customerId,
        deviceId,
        status: session.sessionStatus,
        channel: session.channel,
        authMethod: session.authMethod,
        startedAt: session.startedAt?.toISOString() ?? null,
        endedAt: session.endedAt?.toISOString() ?? null,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
      customer: customer
        ? { customerId: String(customer.id), customerCode: customer.customerCode, lifecycleStatus: customer.lifecycleStatus }
        : null,
      device: device
        ? {
            deviceId: String(device.id),
            riskStatus: device.riskStatus,
            firstSeenAt: device.firstSeenAt?.toISOString() ?? null,
            lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          }
        : null,
      gpsObservations: gpsObservations.map((gps) => ({
        id: String(gps.id),
        capturedAt: gps.capturedAt?.toISOString() ?? null,
        accuracyMeters: gps.gpsAccuracyMeters,
        hasCoordinates: gps.gpsLat !== null && gps.gpsLng !== null,
      })),
      deviceSnapshots: deviceSnapshots.map((snapshot) => ({
        id: String(snapshot.id),
        capturedAt: snapshot.capturedAt?.toISOString() ?? null,
        appVersion: snapshot.appVersion,
        vpnDetected: snapshot.vpnDetected,
        isRooted: snapshot.isRooted,
        isEmulator: snapshot.isEmulator,
      })),
      permissions: permissions.map((permission) => ({
        id: String(permission.id),
        permissionCode: permission.permissionCode,
        granted: permission.granted,
        respondedAt: permission.respondedAt?.toISOString() ?? null,
      })),
      authEvents: authEvents.map((event) => ({
        id: String(event.id),
        eventType: event.eventType,
        loginSuccessful: event.loginSuccessful,
        occurredAt: event.occurredAt?.toISOString() ?? null,
      })),
      ipReputation: ipReputation.map((item) => ({
        id: String(item.id),
        isVpn: item.isVpn,
        isProxy: item.isProxy,
        isTor: item.isTor,
        countryCode: item.countryCode,
        city: item.city,
        reputationScore: item.reputationScore,
        capturedAt: item.capturedAt?.toISOString() ?? null,
      })),
      simObservations: simObservations.map((item) => ({
        id: String(item.id),
        carrierName: item.carrierName,
        simType: item.simType,
        simCount: item.simCount,
        phoneLast4: item.phoneLast4,
        capturedAt: item.capturedAt?.toISOString() ?? null,
      })),
      deviceRiskEvents: riskEvents.map((event) => ({
        id: String(event.id),
        eventType: event.eventType,
        reasonCode: event.reasonCode,
        happenedAt: event.happenedAt?.toISOString() ?? null,
      })),
      customerActions: actions.map((action) => ({
        id: String(action.id),
        eventName: action.eventName,
        screenName: action.screenName,
        occurredAt: action.occurredAt?.toISOString() ?? null,
      })),
      customerObservations: observations.map((observation) => ({
        id: String(observation.id),
        observationCode: observation.observationCode,
        valueBoolean: observation.valueBoolean,
        capturedAt: observation.capturedAt?.toISOString() ?? null,
      })),
      auditTrail: auditTrail.map((audit) => ({
        id: String(audit.id),
        actionCode: audit.actionCode,
        actorType: audit.actorType,
        occurredAt: audit.occurredAt?.toISOString() ?? null,
      })),
    };
  }

  private async createSessionGpsIfAllowed(input: {
    tenantId: string;
    customerId: string;
    sessionId: string;
    gpsObservation: { lat: number; lng: number; accuracyMeters?: number; capturedAt?: string } | undefined;
    canStoreGps: boolean;
    defaultCapturedAt: Date;
    transaction: Transaction;
  }): Promise<SessionGpsResult> {
    if (!input.gpsObservation) {
      return { gpsObservationId: null, gpsObservationCreated: false, gpsObservationSkippedReason: 'gps_not_provided' };
    }
    if (!input.canStoreGps) {
      return { gpsObservationId: null, gpsObservationCreated: false, gpsObservationSkippedReason: 'location_permission_not_granted' };
    }

    const addressContext = await this.sessionsRepository.findCurrentAddressContext(input.tenantId, input.customerId, {
      transaction: input.transaction,
    });
    const capturedAt = toDate(input.gpsObservation.capturedAt, input.defaultCapturedAt);
    const gps = await this.sessionsRepository.createGpsObservation(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        customerAddressId: addressContext.addressId,
        addressVersionId: addressContext.addressVersionId,
        gpsLat: decimal(input.gpsObservation.lat, 7) ?? '0.0000000',
        gpsLng: decimal(input.gpsObservation.lng, 7) ?? '0.0000000',
        gpsAccuracyMeters: decimal(input.gpsObservation.accuracyMeters, 2),
        capturedAt,
      },
      { transaction: input.transaction },
    );

    return { gpsObservationId: String(gps.id), gpsObservationCreated: true, gpsObservationSkippedReason: null };
  }
}
