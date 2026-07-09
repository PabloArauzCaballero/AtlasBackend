import { Injectable } from '@nestjs/common';
import {
  AddressGpsObservationModel,
  AuthEventModel,
  CustomerActionLogModel,
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
import { SessionsActivityAuditRepository } from './repositories/sessions-activity-audit.repository.js';
import { SessionsDeviceRepository } from './repositories/sessions-device.repository.js';
import { SessionsLifecycleRepository } from './repositories/sessions-lifecycle.repository.js';
import { CurrentAddressContext, SessionsLocationRepository } from './repositories/sessions-location.repository.js';
import { SessionsOnboardingLinkRepository } from './repositories/sessions-onboarding-link.repository.js';
import { SessionsTelemetryRepository, RepositoryOptions } from './repositories/sessions-telemetry.repository.js';

export type { RepositoryOptions } from './repositories/sessions-telemetry.repository.js';
export type { CurrentAddressContext } from './repositories/sessions-location.repository.js';

/**
 * ATLAS-P11-T12 (cierra ATLAS-P11-013 / hallazgo de la revisión de calidad post-Fase 4):
 * `SessionsRepository` era un único archivo de 857 líneas con 18 modelos Sequelize inyectados,
 * mezclando 6 responsabilidades distintas (dispositivo, ciclo de vida de sesión, dirección/GPS,
 * telemetría de bajo nivel, vínculo con onboarding, y resumen de actividad + auditoría).
 *
 * Este archivo es ahora una fachada delgada: NINGÚN método público cambió de firma ni de
 * comportamiento respecto a la versión anterior, por lo que los 5 servicios de aplicación que
 * dependen de `SessionsRepository` (`session-start`, `session-heartbeat`, `session-end`,
 * `session-gps-writer`, `session-query`) no requieren ningún cambio. Toda la lógica real vive
 * ahora en `./repositories/*.ts`, cada uno con un único motivo de cambio y sus propios tests
 * más fáciles de escribir de forma aislada.
 */
@Injectable()
export class SessionsRepository {
  constructor(
    private readonly deviceRepository: SessionsDeviceRepository,
    private readonly lifecycleRepository: SessionsLifecycleRepository,
    private readonly locationRepository: SessionsLocationRepository,
    private readonly telemetryRepository: SessionsTelemetryRepository,
    private readonly onboardingLinkRepository: SessionsOnboardingLinkRepository,
    private readonly activityAuditRepository: SessionsActivityAuditRepository,
  ) {}

  // ---- Dispositivo (delega en SessionsDeviceRepository) ----

  findGlobalDevice(
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<GlobalDeviceFingerprintModel | null> {
    return this.deviceRepository.findGlobalDevice(deviceFingerprint, fingerprintVersion, options);
  }

  createGlobalDevice(values: { deviceFingerprint: string; fingerprintVersion: string; now: Date }, options: RepositoryOptions) {
    return this.deviceRepository.createGlobalDevice(values, options);
  }

  touchGlobalDevice(globalDevice: GlobalDeviceFingerprintModel, now: Date, options: RepositoryOptions): Promise<void> {
    return this.deviceRepository.touchGlobalDevice(globalDevice, now, options);
  }

  findDevice(
    tenantId: string,
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<DeviceModel | null> {
    return this.deviceRepository.findDevice(tenantId, deviceFingerprint, fingerprintVersion, options);
  }

  findDeviceById(tenantId: string, deviceId: string, options: RepositoryOptions = {}): Promise<DeviceModel | null> {
    return this.deviceRepository.findDeviceById(tenantId, deviceId, options);
  }

  createDevice(
    values: { tenantId: string; globalDeviceFingerprintId: string; deviceFingerprint: string; fingerprintVersion: string; now: Date },
    options: RepositoryOptions,
  ): Promise<DeviceModel> {
    return this.deviceRepository.createDevice(values, options);
  }

  touchDevice(device: DeviceModel, now: Date, options: RepositoryOptions): Promise<void> {
    return this.deviceRepository.touchDevice(device, now, options);
  }

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string, options: RepositoryOptions) {
    return this.deviceRepository.findCustomerDeviceLink(tenantId, customerId, deviceId, options);
  }

  createCustomerDeviceLink(values: { tenantId: string; customerId: string; deviceId: string; now: Date }, options: RepositoryOptions) {
    return this.deviceRepository.createCustomerDeviceLink(values, options);
  }

  touchCustomerDeviceLink(link: CustomerDeviceLinkModel, sessionId: string, now: Date, options: RepositoryOptions): Promise<void> {
    return this.deviceRepository.touchCustomerDeviceLink(link, sessionId, now, options);
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
    return this.deviceRepository.createDeviceSnapshot(values, options);
  }

  findLatestDeviceSnapshot(tenantId: string, sessionId: string): Promise<DeviceSnapshotModel | null> {
    return this.deviceRepository.findLatestDeviceSnapshot(tenantId, sessionId);
  }

  findSessionDeviceSnapshots(tenantId: string, sessionId: string, limit = 10): Promise<DeviceSnapshotModel[]> {
    return this.deviceRepository.findSessionDeviceSnapshots(tenantId, sessionId, limit);
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
    return this.deviceRepository.createDeviceRiskEvent(values, options);
  }

  findDeviceRiskEvents(tenantId: string, deviceId: string, limit = 20): Promise<DeviceRiskEventModel[]> {
    return this.deviceRepository.findDeviceRiskEvents(tenantId, deviceId, limit);
  }

  // ---- Ciclo de vida de sesión (delega en SessionsLifecycleRepository) ----

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
    return this.lifecycleRepository.createSession(values, options);
  }

  findSessionById(
    tenantId: string,
    customerId: string,
    sessionId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerSessionModel | null> {
    return this.lifecycleRepository.findSessionById(tenantId, customerId, sessionId, options);
  }

  findSessionForOperations(tenantId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.lifecycleRepository.findSessionForOperations(tenantId, sessionId);
  }

  findLatestActiveSession(tenantId: string, customerId: string): Promise<CustomerSessionModel | null> {
    return this.lifecycleRepository.findLatestActiveSession(tenantId, customerId);
  }

  endSession(session: CustomerSessionModel, endedAt: Date, options: RepositoryOptions): Promise<CustomerSessionModel> {
    return this.lifecycleRepository.endSession(session, endedAt, options);
  }

  findCustomerSessions(input: { tenantId: string; customerId: string; page: number; limit: number }) {
    return this.lifecycleRepository.findCustomerSessions(input);
  }

  // ---- Dirección / GPS (delega en SessionsLocationRepository) ----

  findCurrentAddressContext(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CurrentAddressContext> {
    return this.locationRepository.findCurrentAddressContext(tenantId, customerId, options);
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
    return this.locationRepository.createGpsObservation(values, options);
  }

  findLatestGpsObservation(tenantId: string, sessionId: string): Promise<AddressGpsObservationModel | null> {
    return this.locationRepository.findLatestGpsObservation(tenantId, sessionId);
  }

  findSessionGpsObservations(tenantId: string, sessionId: string, limit = 30): Promise<AddressGpsObservationModel[]> {
    return this.locationRepository.findSessionGpsObservations(tenantId, sessionId, limit);
  }

  // ---- Telemetría de bajo nivel (delega en SessionsTelemetryRepository) ----

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
    return this.telemetryRepository.createPermissionEvent(values, options);
  }

  findSessionPermissionEvents(tenantId: string, sessionId: string, limit = 20): Promise<PermissionEventModel[]> {
    return this.telemetryRepository.findSessionPermissionEvents(tenantId, sessionId, limit);
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
    return this.telemetryRepository.createAuthEvent(values, options);
  }

  findSessionAuthEvents(tenantId: string, sessionId: string, limit = 20): Promise<AuthEventModel[]> {
    return this.telemetryRepository.findSessionAuthEvents(tenantId, sessionId, limit);
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
    return this.telemetryRepository.createIpReputation(values, options);
  }

  findSessionIpReputation(tenantId: string, sessionId: string, limit = 10): Promise<IpReputationObservationModel[]> {
    return this.telemetryRepository.findSessionIpReputation(tenantId, sessionId, limit);
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
    return this.telemetryRepository.createSimObservation(values, options);
  }

  findSessionSimObservations(tenantId: string, sessionId: string, limit = 10): Promise<SimObservationModel[]> {
    return this.telemetryRepository.findSessionSimObservations(tenantId, sessionId, limit);
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
    return this.telemetryRepository.createCustomerAction(values, options);
  }

  findSessionCustomerActions(tenantId: string, sessionId: string, limit = 30): Promise<CustomerActionLogModel[]> {
    return this.telemetryRepository.findSessionCustomerActions(tenantId, sessionId, limit);
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
    return this.telemetryRepository.createCustomerObservation(values, options);
  }

  findSessionCustomerObservations(tenantId: string, sessionId: string, limit = 30): Promise<CustomerObservationModel[]> {
    return this.telemetryRepository.findSessionCustomerObservations(tenantId, sessionId, limit);
  }

  // ---- Vínculo con onboarding (delega en SessionsOnboardingLinkRepository) ----

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.onboardingLinkRepository.findLatestOnboardingFlow(tenantId, customerId, options);
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
    return this.onboardingLinkRepository.createOnboardingStepEvent(values, options);
  }

  // ---- Resumen de actividad + auditoría (delega en SessionsActivityAuditRepository) ----

  upsertActivitySummary(
    values: { tenantId: string; customerId: string; deviceId: string; now: Date; incrementSessionCount: boolean },
    options: RepositoryOptions,
  ): Promise<void> {
    return this.activityAuditRepository.upsertActivitySummary(values, options);
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
    return this.activityAuditRepository.createAudit(values, options);
  }

  findSessionAudits(tenantId: string, sessionId: string, limit = 30): Promise<OperationalAuditLogModel[]> {
    return this.activityAuditRepository.findSessionAudits(tenantId, sessionId, limit);
  }
}
