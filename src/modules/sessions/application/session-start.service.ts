import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { toStartSessionResponse } from '../sessions.mapper.js';
import { StartSessionDto } from '../sessions.schemas.js';
import { SessionsRepository } from '../sessions.repository.js';
import { SessionGpsWriterService } from './session-gps-writer.service.js';
import { decimal, hasLocationPermission, RequestContext, riskFlagsFromSnapshot, toDate } from './sessions.shared.js';

@Injectable()
export class SessionStartService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly gpsWriter: SessionGpsWriterService,
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

      const gpsResult = await this.gpsWriter.createSessionGpsIfAllowed({
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
}
