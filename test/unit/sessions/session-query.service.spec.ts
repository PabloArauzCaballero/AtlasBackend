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
});
