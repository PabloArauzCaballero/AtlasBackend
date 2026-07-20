import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionHeartbeatService } from '../../../src/modules/sessions/application/session-heartbeat.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `SessionHeartbeatService.heartbeat` (228 líneas). El caso más importante es
 * `SESSION_NOT_ACTIVE`: un heartbeat sobre una sesión ya cerrada/expirada no debe reactivarla ni
 * registrar telemetría como si la sesión siguiera viva. El segundo caso más importante es que la
 * verificación de vínculo dispositivo-cliente solo bloquea a un `role: 'customer'` — un operador
 * interno investigando puede mandar heartbeats sobre un dispositivo no vinculado sin que lo
 * frene la misma regla que protege al cliente final.
 */
describe('SessionHeartbeatService.heartbeat', () => {
  function buildService() {
    const sessionsRepository = {
      findSessionById: jest.fn(),
      findDeviceById: jest.fn(),
      findCustomerDeviceLink: jest.fn(),
      touchDevice: jest.fn(),
      touchCustomerDeviceLink: jest.fn(),
      findLatestOnboardingFlow: jest.fn(),
      createPermissionEvent: jest.fn(),
      createDeviceSnapshot: jest.fn(),
      createSimObservation: jest.fn(),
      createIpReputation: jest.fn(),
      createDeviceRiskEvent: jest.fn(),
      createCustomerAction: jest.fn(),
      createCustomerObservation: jest.fn(),
      upsertActivitySummary: jest.fn(),
      createAudit: jest.fn(),
    };
    const customersRepository = { findById: jest.fn() };
    const gpsWriter = {
      createSessionGpsIfAllowed: jest.fn(async () => ({
        gpsObservationId: null,
        gpsObservationCreated: false,
        gpsObservationSkippedReason: 'gps_not_provided',
      })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new SessionHeartbeatService(
      sessionsRepository as never,
      customersRepository as never,
      gpsWriter as never,
      sequelize as never,
    );
    return { service, sessionsRepository, customersRepository, gpsWriter };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const internalUser = { role: 'internal_operator', customerId: null, internalUserId: 'iu1', platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: '10.0.0.1', userAgent: 'AtlasApp/1.0', idempotencyKey: 'idem-1' };

  function baseBody(overrides: Record<string, unknown> = {}) {
    return { deviceId: 'device-1', permissionChanges: [], ...overrides };
  }

  it('throws BadRequestException without an idempotency key', async () => {
    const { service } = buildService();
    await expect(
      service.heartbeat({
        customerId: 'c1',
        sessionId: 's1',
        body: baseBody() as never,
        currentUser: customerUser,
        context: { ...context, idempotencyKey: undefined },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when the session does not exist', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(
      service.heartbeat({ customerId: 'c1', sessionId: 'missing', body: baseBody() as never, currentUser: customerUser, context }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws UnprocessableEntityException SESSION_NOT_ACTIVE when the session status is not "active" — the most important rule of this file', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'ended',
      deviceId: 'device-1',
    } as never);
    await expect(
      service.heartbeat({ customerId: 'c1', sessionId: 's1', body: baseBody() as never, currentUser: customerUser, context }),
    ).rejects.toThrow(/SESSION_NOT_ACTIVE/);
    expect(sessionsRepository.touchDevice).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when the deviceId in the body does not match the session's own device", async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-owner-of-session',
    } as never);
    await expect(
      service.heartbeat({
        customerId: 'c1',
        sessionId: 's1',
        body: baseBody({ deviceId: 'a-different-device' }) as never,
        currentUser: customerUser,
        context,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when the device itself does not exist', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(
      service.heartbeat({ customerId: 'c1', sessionId: 's1', body: baseBody() as never, currentUser: customerUser, context }),
    ).rejects.toThrow(NotFoundException);
  });

  it('a customer role gets ForbiddenException when the device is not linked to them', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(
      service.heartbeat({ customerId: 'c1', sessionId: 's1', body: baseBody() as never, currentUser: customerUser, context }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('an internal role does NOT get blocked by a missing device link — only "customer" role is', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    (sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    const result = await service.heartbeat({
      customerId: 'c1',
      sessionId: 's1',
      body: baseBody() as never,
      currentUser: internalUser,
      context,
    });

    expect(result.status).toBe('accepted');
  });

  it('never increments the session count in the activity summary — a heartbeat is not a new session', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
    (sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.heartbeat({ customerId: 'c1', sessionId: 's1', body: baseBody() as never, currentUser: customerUser, context });

    const summaryArgs = (sessionsRepository.upsertActivitySummary as jest.Mock).mock.calls[0][0] as { incrementSessionCount: boolean };
    expect(summaryArgs.incrementSessionCount).toBe(false);
  });

  it('counts and reports riskSignalsCreated accurately from the device snapshot flags', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
    (sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    const result = await service.heartbeat({
      customerId: 'c1',
      sessionId: 's1',
      body: baseBody({ deviceSnapshot: { isRooted: true, isEmulator: true, vpnDetected: false } }) as never,
      currentUser: customerUser,
      context,
    });

    expect(result.riskSignalsCreated).toBe(2);
    expect(sessionsRepository.createDeviceRiskEvent).toHaveBeenCalledTimes(2);
  });

  it('creates one permission event per item in permissionChanges', async () => {
    const { service, customersRepository, sessionsRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
    (sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.heartbeat({
      customerId: 'c1',
      sessionId: 's1',
      body: baseBody({
        permissionChanges: [
          { permissionCode: 'camera', granted: true },
          { permissionCode: 'location', granted: false },
        ],
      }) as never,
      currentUser: customerUser,
      context,
    });

    expect(sessionsRepository.createPermissionEvent).toHaveBeenCalledTimes(2);
  });

  describe('telemetría opcional completa (cubre ambos lados de cada ?? null)', () => {
    function arrangeHappyPath(flow: unknown = { id: 'flow-1' }) {
      const built = buildService();
      (built.customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (built.sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
        id: 's1',
        sessionStatus: 'active',
        deviceId: 'device-1',
      } as never);
      (built.sessionsRepository.findDeviceById as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
      (built.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
      (built.sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(flow as never);
      return built;
    }

    it('con snapshot, SIM e IP completos persiste cada bloque con sus valores y liga el flow de onboarding', async () => {
      const { service, sessionsRepository } = arrangeHappyPath();
      await service.heartbeat({
        customerId: 'c1',
        sessionId: 's1',
        currentUser: customerUser,
        context,
        body: baseBody({
          permissionChanges: [{ permissionCode: 'location', granted: true, decidedAt: '2026-01-01T00:00:00.000Z' }],
          deviceSnapshot: {
            brand: 'Samsung',
            model: 'A54',
            osFamily: 'android',
            osVersion: '14',
            appVersion: '1.2.3',
            isRooted: false,
            isEmulator: false,
            vpnDetected: true,
          },
          simObservation: { phoneNumberHash: 'h', phoneLast4: '1234', carrierName: 'Tigo', simType: 'physical', simCount: 2 },
          ipReputation: { isVpn: true, isProxy: false, isTor: false, countryCode: 'BO', city: 'La Paz', reputationScore: 0.42 },
        }) as never,
      });

      expect((sessionsRepository.createPermissionEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
        onboardingFlowId: 'flow-1',
        permissionCode: 'location',
      });
      expect((sessionsRepository.createDeviceSnapshot as jest.Mock).mock.calls[0][0]).toMatchObject({
        brand: 'Samsung',
        osVersion: '14',
        vpnDetected: true,
      });
      expect((sessionsRepository.createSimObservation as jest.Mock).mock.calls[0][0]).toMatchObject({
        carrierName: 'Tigo',
        phoneLast4: '1234',
        simCount: 2,
      });
      expect((sessionsRepository.createIpReputation as jest.Mock).mock.calls[0][0]).toMatchObject({
        isVpn: true,
        countryCode: 'BO',
        city: 'La Paz',
        ipAddress: '10.0.0.1',
      });
    });

    it('con los bloques presentes pero vacíos, cada campo opcional cae a null (y sin flow, onboardingFlowId es null)', async () => {
      const { service, sessionsRepository } = arrangeHappyPath(null);
      await service.heartbeat({
        customerId: 'c1',
        sessionId: 's1',
        currentUser: customerUser,
        context,
        body: baseBody({
          permissionChanges: [{ permissionCode: 'camera', granted: false }],
          deviceSnapshot: {},
          simObservation: {},
          ipReputation: {},
        }) as never,
      });

      expect((sessionsRepository.createPermissionEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ onboardingFlowId: null });
      expect((sessionsRepository.createDeviceSnapshot as jest.Mock).mock.calls[0][0]).toMatchObject({
        brand: null,
        model: null,
        osFamily: null,
        osVersion: null,
        appVersion: null,
        isRooted: null,
        isEmulator: null,
        vpnDetected: null,
      });
      expect((sessionsRepository.createSimObservation as jest.Mock).mock.calls[0][0]).toMatchObject({
        phoneNumberHash: null,
        phoneLast4: null,
        carrierName: null,
        simType: null,
        simCount: null,
      });
      expect((sessionsRepository.createIpReputation as jest.Mock).mock.calls[0][0]).toMatchObject({
        isVpn: null,
        isProxy: null,
        isTor: null,
        countryCode: null,
        city: null,
      });
    });
  });
});
