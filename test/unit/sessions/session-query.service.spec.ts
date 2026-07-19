import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionQueryService } from '../../../src/modules/sessions/application/session-query.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5): último
 * servicio de aplicación de `sessions` sin cubrir. El caso más importante es `hasRecentGps`: la
 * ventana de 30 minutos que decide si la última ubicación conocida del cliente cuenta como
 * "reciente" para el panel de operaciones — un límite mal calculado mostraría una ubicación
 * vieja como si fuera actual, o viceversa.
 */
describe('SessionQueryService', () => {
  function buildService() {
    const sessionsRepository = {
      findLatestActiveSession: jest.fn(),
      findDeviceById: jest.fn(),
      findCustomerDeviceLink: jest.fn(),
      findLatestGpsObservation: jest.fn(),
      findLatestDeviceSnapshot: jest.fn(),
      findSessionForOperations: jest.fn(),
      findSessionGpsObservations: jest.fn(async () => []),
      findSessionDeviceSnapshots: jest.fn(async () => []),
      findSessionPermissionEvents: jest.fn(async () => []),
      findSessionAuthEvents: jest.fn(async () => []),
      findSessionIpReputation: jest.fn(async () => []),
      findSessionSimObservations: jest.fn(async () => []),
      findDeviceRiskEvents: jest.fn(async () => []),
      findSessionCustomerActions: jest.fn(async () => []),
      findSessionCustomerObservations: jest.fn(async () => []),
      findSessionAudits: jest.fn(async () => []),
    };
    const customersRepository = { findById: jest.fn() };
    const service = new SessionQueryService(sessionsRepository as never, customersRepository as never);
    return { service, sessionsRepository, customersRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const internalUser = { role: 'internal_operator', customerId: null, internalUserId: 'iu1', platformUserId: null } as never;

  describe('getSessionState', () => {
    it("throws ForbiddenException when a customer token requests another customer's session state", async () => {
      const { service } = buildService();
      await expect(service.getSessionState({ tenantId: 't1', customerId: 'someone-else', currentUser: customerUser })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an explicit "no active session" shape (not an error) when the customer has none', async () => {
      const { service, customersRepository, sessionsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (sessionsRepository.findLatestActiveSession as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result).toEqual({
        customerId: 'c1',
        activeSession: null,
        device: null,
        location: { lastGpsObservedAt: null, hasRecentGps: false },
      });
    });

    it('hasRecentGps is true when the last GPS observation is within the last 30 minutes', async () => {
      const { service, customersRepository, sessionsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (sessionsRepository.findLatestActiveSession as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        deviceId: null,
        sessionStatus: 'active',
        startedAt: new Date(),
      } as never);
      (sessionsRepository.findLatestGpsObservation as jest.Mock).mockResolvedValueOnce({
        capturedAt: new Date(Date.now() - 5 * 60_000),
      } as never);
      (sessionsRepository.findLatestDeviceSnapshot as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result.location.hasRecentGps).toBe(true);
    });

    it('hasRecentGps is false once the last GPS observation is older than 30 minutes', async () => {
      const { service, customersRepository, sessionsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (sessionsRepository.findLatestActiveSession as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        deviceId: null,
        sessionStatus: 'active',
        startedAt: new Date(),
      } as never);
      (sessionsRepository.findLatestGpsObservation as jest.Mock).mockResolvedValueOnce({
        capturedAt: new Date(Date.now() - 45 * 60_000),
      } as never);
      (sessionsRepository.findLatestDeviceSnapshot as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result.location.hasRecentGps).toBe(false);
    });

    it('hasRecentGps is false (not an error) when there is no GPS observation at all', async () => {
      const { service, customersRepository, sessionsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (sessionsRepository.findLatestActiveSession as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        deviceId: null,
        sessionStatus: 'active',
        startedAt: new Date(),
      } as never);
      (sessionsRepository.findLatestGpsObservation as jest.Mock).mockResolvedValueOnce(null as never);
      (sessionsRepository.findLatestDeviceSnapshot as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result.location).toEqual({ lastGpsObservedAt: null, hasRecentGps: false });
    });

    it('does not look up a device at all when the active session has no deviceId', async () => {
      const { service, customersRepository, sessionsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (sessionsRepository.findLatestActiveSession as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        deviceId: null,
        sessionStatus: 'active',
        startedAt: new Date(),
      } as never);
      (sessionsRepository.findLatestGpsObservation as jest.Mock).mockResolvedValueOnce(null as never);
      (sessionsRepository.findLatestDeviceSnapshot as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(sessionsRepository.findDeviceById).not.toHaveBeenCalled();
      expect(result.device).toBeNull();
    });
  });

  describe('getOperationsSessionSummary', () => {
    it('rejects a non-internal actor', async () => {
      const { service } = buildService();
      await expect(service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: customerUser })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the session does not exist', async () => {
      const { service, sessionsRepository } = buildService();
      (sessionsRepository.findSessionForOperations as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 'missing', currentUser: internalUser }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not query device risk events at all when the session has no deviceId', async () => {
      const { service, sessionsRepository } = buildService();
      (sessionsRepository.findSessionForOperations as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        customerId: null,
        deviceId: null,
        sessionStatus: 'active',
      } as never);

      await service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: internalUser });

      expect(sessionsRepository.findDeviceRiskEvents).not.toHaveBeenCalled();
    });

    it('fetches device risk events when the session does have a deviceId', async () => {
      const { service, sessionsRepository } = buildService();
      (sessionsRepository.findSessionForOperations as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        customerId: null,
        deviceId: 'device-1',
        sessionStatus: 'active',
      } as never);

      await service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: internalUser });

      expect(sessionsRepository.findDeviceRiskEvents).toHaveBeenCalledWith('t1', 'device-1');
    });

    it('fetches the telemetry collections for the requested session/tenant scope', async () => {
      const { service, sessionsRepository } = buildService();
      (sessionsRepository.findSessionForOperations as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        customerId: null,
        deviceId: null,
        sessionStatus: 'active',
      } as never);

      await service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: internalUser });

      expect(sessionsRepository.findSessionGpsObservations).toHaveBeenCalledWith('t1', 's1');
      expect(sessionsRepository.findSessionDeviceSnapshots).toHaveBeenCalledWith('t1', 's1');
      expect(sessionsRepository.findSessionAudits).toHaveBeenCalledWith('t1', 's1');
    });

    it('does not look up a customer at all when the session has no customerId', async () => {
      const { service, sessionsRepository, customersRepository } = buildService();
      (sessionsRepository.findSessionForOperations as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        customerId: null,
        deviceId: null,
        sessionStatus: 'active',
      } as never);

      const result = await service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: internalUser });

      expect(customersRepository.findById).not.toHaveBeenCalled();
      expect(result.customer).toBeNull();
    });
  });

  describe('mapeo con datos completos (cubre el lado "presente" de cada rama)', () => {
    const date = new Date('2026-01-01T10:00:00.000Z');
    const iso = date.toISOString();

    it('getSessionState con dispositivo, vínculo y snapshot presentes los proyecta completos', async () => {
      const { service, sessionsRepository, customersRepository } = buildService();
      customersRepository.findById.mockResolvedValue({ id: 'c1' } as never);
      sessionsRepository.findLatestActiveSession.mockResolvedValue({ id: 's1', deviceId: 'd1', sessionStatus: 'active', startedAt: date } as never);
      sessionsRepository.findDeviceById.mockResolvedValue({ id: 'd1', riskStatus: 'clean' } as never);
      sessionsRepository.findCustomerDeviceLink.mockResolvedValue({ trustLevel: 'trusted' } as never);
      sessionsRepository.findLatestGpsObservation.mockResolvedValue({ capturedAt: new Date() } as never);
      sessionsRepository.findLatestDeviceSnapshot.mockResolvedValue({ capturedAt: date, appVersion: '1.2.3', vpnDetected: false, isRooted: false, isEmulator: true } as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result.activeSession).toMatchObject({ sessionId: 's1', status: 'active', startedAt: iso });
      expect(result.device).toMatchObject({ deviceId: 'd1', trustLevel: 'trusted', riskStatus: 'clean' });
      expect(result.device?.latestSnapshot).toMatchObject({ capturedAt: iso, appVersion: '1.2.3', isEmulator: true });
    });

    it('getSessionState aplica los defaults cuando faltan estado/fechas/vínculo', async () => {
      const { service, sessionsRepository, customersRepository } = buildService();
      customersRepository.findById.mockResolvedValue({ id: 'c1' } as never);
      sessionsRepository.findLatestActiveSession.mockResolvedValue({ id: 's1', deviceId: 'd1', sessionStatus: null, startedAt: null } as never);
      sessionsRepository.findDeviceById.mockResolvedValue({ id: 'd1', riskStatus: null } as never);
      sessionsRepository.findCustomerDeviceLink.mockResolvedValue(null as never);
      sessionsRepository.findLatestGpsObservation.mockResolvedValue(null as never);
      sessionsRepository.findLatestDeviceSnapshot.mockResolvedValue({ capturedAt: null, appVersion: null, vpnDetected: null, isRooted: null, isEmulator: null } as never);

      const result = await service.getSessionState({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

      expect(result.activeSession).toMatchObject({ status: 'active', startedAt: null });
      expect(result.device).toMatchObject({ trustLevel: null, riskStatus: null });
      expect(result.device?.latestSnapshot).toMatchObject({ capturedAt: null });
      expect(result.location).toMatchObject({ lastGpsObservedAt: null, hasRecentGps: false });
    });

    it('getOperationsSessionSummary proyecta cliente, dispositivo y las 10 colecciones (con y sin fecha)', async () => {
      const { service, sessionsRepository, customersRepository } = buildService();
      sessionsRepository.findSessionForOperations.mockResolvedValue({
        id: 's1', customerId: 'c1', deviceId: 'd1', sessionStatus: 'active', channel: 'mobile_app',
        authMethod: 'password', startedAt: date, endedAt: date, ipAddress: '1.2.3.4', userAgent: 'ua',
      } as never);
      customersRepository.findById.mockResolvedValue({ id: 'c1', customerCode: 'C-1', lifecycleStatus: 'active' } as never);
      sessionsRepository.findDeviceById.mockResolvedValue({ id: 'd1', riskStatus: 'clean', firstSeenAt: date, lastSeenAt: date } as never);
      // Cada colección con 2 filas: una con fecha (rama toISOString) y otra sin (rama ?? null).
      sessionsRepository.findSessionGpsObservations.mockResolvedValue([
        { id: 1, capturedAt: date, gpsAccuracyMeters: '5', gpsLat: '-16.5', gpsLng: '-68.1' },
        { id: 2, capturedAt: null, gpsAccuracyMeters: null, gpsLat: null, gpsLng: null },
      ] as never);
      sessionsRepository.findSessionDeviceSnapshots.mockResolvedValue([{ id: 1, capturedAt: date }, { id: 2, capturedAt: null }] as never);
      sessionsRepository.findSessionPermissionEvents.mockResolvedValue([{ id: 1, permissionCode: 'location', granted: true, respondedAt: date }, { id: 2, respondedAt: null }] as never);
      sessionsRepository.findSessionAuthEvents.mockResolvedValue([{ id: 1, eventType: 'login', loginSuccessful: true, occurredAt: date }, { id: 2, occurredAt: null }] as never);
      sessionsRepository.findSessionIpReputation.mockResolvedValue([{ id: 1, isVpn: true, capturedAt: date }, { id: 2, capturedAt: null }] as never);
      sessionsRepository.findSessionSimObservations.mockResolvedValue([{ id: 1, carrierName: 'Tigo', capturedAt: date }, { id: 2, capturedAt: null }] as never);
      sessionsRepository.findDeviceRiskEvents.mockResolvedValue([{ id: 1, eventType: 'root', reasonCode: 'R', happenedAt: date }, { id: 2, happenedAt: null }] as never);
      sessionsRepository.findSessionCustomerActions.mockResolvedValue([{ id: 1, eventName: 'tap', occurredAt: date }, { id: 2, occurredAt: null }] as never);
      sessionsRepository.findSessionCustomerObservations.mockResolvedValue([{ id: 1, observationCode: 'o', valueBoolean: true, capturedAt: date }, { id: 2, capturedAt: null }] as never);
      sessionsRepository.findSessionAudits.mockResolvedValue([{ id: 1, actionCode: 'a', actorType: 'system', occurredAt: date }, { id: 2, occurredAt: null }] as never);

      const result = await service.getOperationsSessionSummary({ tenantId: 't1', sessionId: 's1', currentUser: internalUser });

      expect(result.session).toMatchObject({ sessionId: 's1', customerId: 'c1', deviceId: 'd1', startedAt: iso, endedAt: iso });
      expect(result.customer).toMatchObject({ customerId: 'c1', customerCode: 'C-1' });
      expect(result.device).toMatchObject({ deviceId: 'd1', firstSeenAt: iso, lastSeenAt: iso });
      // hasCoordinates: true con lat/lng, false cuando alguna es null
      expect(result.gpsObservations[0]).toMatchObject({ capturedAt: iso, hasCoordinates: true });
      expect(result.gpsObservations[1]).toMatchObject({ capturedAt: null, hasCoordinates: false });
      for (const key of ['deviceSnapshots', 'permissions', 'authEvents', 'ipReputation', 'simObservations', 'deviceRiskEvents', 'customerActions', 'customerObservations', 'auditTrail'] as const) {
        expect((result as unknown as Record<string, unknown[]>)[key]).toHaveLength(2);
      }
      expect(result.auditTrail[0].occurredAt).toBe(iso);
      expect(result.auditTrail[1].occurredAt).toBeNull();
    });
  });
});
