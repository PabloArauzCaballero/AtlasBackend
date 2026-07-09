import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { SessionsRepository } from '../sessions.repository.js';
import { assertInternalAccess } from './sessions.shared.js';

@Injectable()
export class SessionQueryService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

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
}
