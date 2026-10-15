/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
 * @system orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { SessionsDeviceRepository } from '../repositories/sessions-device.repository.js';
import { SessionsLifecycleRepository } from '../repositories/sessions-lifecycle.repository.js';
import { SessionsLocationRepository } from '../repositories/sessions-location.repository.js';
import { SessionsCustomerActivityRepository } from '../repositories/sessions-customer-activity.repository.js';
import { SessionsTelemetryRepository } from '../repositories/sessions-telemetry.repository.js';
import { SessionsActivityAuditRepository } from '../repositories/sessions-activity-audit.repository.js';
import { assertInternalAccess } from './sessions.shared.js';

@Injectable()
export class SessionQueryService {
  constructor(
    private readonly deviceRepository: SessionsDeviceRepository,
    private readonly lifecycleRepository: SessionsLifecycleRepository,
    private readonly locationRepository: SessionsLocationRepository,
    private readonly telemetryRepository: SessionsTelemetryRepository,
    private readonly customerActivityRepository: SessionsCustomerActivityRepository,
    private readonly activityAuditRepository: SessionsActivityAuditRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  async getSessionState(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    const session = await this.lifecycleRepository.findLatestActiveSession(input.tenantId, input.customerId);
    if (!session) {
      return {
        customerId: input.customerId,
        activeSession: null,
        device: null,
        location: { lastGpsObservedAt: null, hasRecentGps: false },
      };
    }
    const deviceId = session.deviceId ? String(session.deviceId) : null;
    // Los 4 lookups son independientes entre sí (ninguno necesita el resultado de otro, solo
    // deviceId/session.id ya conocidos) — se piden en paralelo en vez de en secuencia.
    const [device, link, latestGps, latestSnapshot] = await Promise.all([
      deviceId ? this.deviceRepository.findDeviceById(input.tenantId, deviceId) : Promise.resolve(null),
      deviceId ? this.deviceRepository.findCustomerDeviceLink(input.tenantId, input.customerId, deviceId, {}) : Promise.resolve(null),
      this.locationRepository.findLatestGpsObservation(input.tenantId, String(session.id)),
      this.deviceRepository.findLatestDeviceSnapshot(input.tenantId, String(session.id)),
    ]);

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
    const session = await this.lifecycleRepository.findSessionForOperations(input.tenantId, input.sessionId);
    if (!session) throw new NotFoundException('Sesión no encontrada.');

    const customerId = session.customerId ? String(session.customerId) : null;
    const deviceId = session.deviceId ? String(session.deviceId) : null;
    const customer = customerId ? await this.customersRepository.findById(input.tenantId, customerId) : null;
    const device = deviceId ? await this.deviceRepository.findDeviceById(input.tenantId, deviceId) : null;
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
      this.locationRepository.findSessionGpsObservations(input.tenantId, input.sessionId),
      this.deviceRepository.findSessionDeviceSnapshots(input.tenantId, input.sessionId),
      this.telemetryRepository.findSessionPermissionEvents(input.tenantId, input.sessionId),
      this.telemetryRepository.findSessionAuthEvents(input.tenantId, input.sessionId),
      this.telemetryRepository.findSessionIpReputation(input.tenantId, input.sessionId),
      this.telemetryRepository.findSessionSimObservations(input.tenantId, input.sessionId),
      deviceId ? this.deviceRepository.findDeviceRiskEvents(input.tenantId, deviceId) : Promise.resolve([]),
      this.customerActivityRepository.findSessionCustomerActions(input.tenantId, input.sessionId),
      this.customerActivityRepository.findSessionCustomerObservations(input.tenantId, input.sessionId),
      this.activityAuditRepository.findSessionAudits(input.tenantId, input.sessionId),
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
