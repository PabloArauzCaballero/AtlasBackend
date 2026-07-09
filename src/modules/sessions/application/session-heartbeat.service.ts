import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { HeartbeatResponseDto } from '../sessions.dtos.js';
import { SessionHeartbeatDto } from '../sessions.schemas.js';
import { SessionsRepository } from '../sessions.repository.js';
import { SessionGpsWriterService } from './session-gps-writer.service.js';
import { decimal, hasLocationPermission, RequestContext, riskFlagsFromSnapshot, toDate } from './sessions.shared.js';

@Injectable()
export class SessionHeartbeatService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly gpsWriter: SessionGpsWriterService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

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

      const gpsResult = await this.gpsWriter.createSessionGpsIfAllowed({
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
}
