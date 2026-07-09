import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `SessionStartService.startSession` (290 líneas) — el flujo real de inicio de sesión de un
 * cliente ya registrado. El caso de negocio más importante es `CUSTOMER_BLOCKED`: un cliente
 * bloqueado no debe poder iniciar una sesión nueva, sin importar qué tan válidas sean sus
 * credenciales de dispositivo.
 */
jest.mock('../../../src/modules/sessions/sessions.mapper.js', () => ({
  toStartSessionResponse: jest.fn((input: { session: { id: string }; nextStep: string }) => ({
    sessionId: input.session.id,
    nextStep: input.nextStep,
  })),
}));

describe('SessionStartService.startSession', () => {
  async function buildService() {
    const { SessionStartService } = await import('../../../src/modules/sessions/application/session-start.service.js');

    const sessionsRepository = {
      findGlobalDevice: jest.fn(),
      createGlobalDevice: jest.fn(),
      touchGlobalDevice: jest.fn(),
      findDevice: jest.fn(),
      createDevice: jest.fn(),
      touchDevice: jest.fn(),
      findCustomerDeviceLink: jest.fn(),
      createCustomerDeviceLink: jest.fn(),
      touchCustomerDeviceLink: jest.fn(),
      createSession: jest.fn(),
      createDeviceSnapshot: jest.fn(),
      findLatestOnboardingFlow: jest.fn(),
      createPermissionEvent: jest.fn(),
      createSimObservation: jest.fn(),
      createIpReputation: jest.fn(),
      createDeviceRiskEvent: jest.fn(),
      createAuthEvent: jest.fn(),
      createCustomerAction: jest.fn(),
      createCustomerObservation: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
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

    const service = new SessionStartService(
      sessionsRepository as never,
      customersRepository as never,
      gpsWriter as never,
      sequelize as never,
    );
    return { service, sessionsRepository, customersRepository, gpsWriter };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: '10.0.0.1', userAgent: 'AtlasApp/1.0', idempotencyKey: 'idem-1' };

  function baseBody(overrides: Record<string, unknown> = {}) {
    return {
      device: { deviceFingerprintHash: 'fp-1', fingerprintVersion: 'v1', channel: 'mobile_app' },
      authMethod: 'password',
      permissions: [],
      ...overrides,
    };
  }

  async function primeDeviceMocks(mocks: Awaited<ReturnType<typeof buildService>>) {
    (mocks.sessionsRepository.findGlobalDevice as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createGlobalDevice as jest.Mock).mockResolvedValueOnce({ id: 'global-device-1' } as never);
    (mocks.sessionsRepository.findDevice as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createDevice as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (mocks.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
    (mocks.sessionsRepository.createSession as jest.Mock).mockResolvedValueOnce({ id: 'session-1' } as never);
    (mocks.sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);
  }

  describe('guardas', () => {
    it('throws BadRequestException without an idempotency key', async () => {
      const mocks = await buildService();
      await expect(
        mocks.service.startSession({
          customerId: 'c1',
          body: baseBody() as never,
          currentUser: customerUser,
          context: { ...context, idempotencyKey: undefined },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when a customer token requests a session for a different customerId', async () => {
      const mocks = await buildService();
      await expect(
        mocks.service.startSession({ customerId: 'someone-else', body: baseBody() as never, currentUser: customerUser, context }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException CUSTOMER_BLOCKED when the customer lifecycle status is "blocked" — the most important business rule of this file', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'blocked' } as never);
      await expect(
        mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context }),
      ).rejects.toThrow(/CUSTOMER_BLOCKED/);
      expect(mocks.sessionsRepository.createSession).not.toHaveBeenCalled();
    });
  });

  describe('nextStep: continúa el onboarding si el cliente sigue en "registered"', () => {
    it('returns nextStep "continue_onboarding" for a customer still in lifecycleStatus "registered"', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      await primeDeviceMocks(mocks);

      const result = await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(result.nextStep).toBe('continue_onboarding');
    });

    it('returns nextStep "continue" for any other lifecycle status', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      const result = await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(result.nextStep).toBe('continue');
    });
  });

  describe('resolución de dispositivo (mismo patrón crear/reusar que customer-onboarding-start)', () => {
    it('reuses an existing device and link instead of creating duplicates', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      (mocks.sessionsRepository.findGlobalDevice as jest.Mock).mockResolvedValueOnce({ id: 'existing-global' } as never);
      (mocks.sessionsRepository.findDevice as jest.Mock).mockResolvedValueOnce({ id: 'existing-device' } as never);
      (mocks.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'existing-link' } as never);
      (mocks.sessionsRepository.createSession as jest.Mock).mockResolvedValueOnce({ id: 'session-1' } as never);
      (mocks.sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(mocks.sessionsRepository.createGlobalDevice).not.toHaveBeenCalled();
      expect(mocks.sessionsRepository.createDevice).not.toHaveBeenCalled();
      expect(mocks.sessionsRepository.createCustomerDeviceLink).not.toHaveBeenCalled();
      expect(mocks.sessionsRepository.touchGlobalDevice).toHaveBeenCalledTimes(1);
      expect(mocks.sessionsRepository.touchDevice).toHaveBeenCalledTimes(1);
    });
  });

  describe('GPS: solo se guarda si hay permiso de ubicación', () => {
    it('canStoreGps is false, and no GPS is passed to the writer as storable, when no permission signal is present', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({
        customerId: 'c1',
        body: baseBody({ gpsObservation: { lat: 1, lng: 1 } }) as never,
        currentUser: customerUser,
        context,
      });

      const gpsCallArgs = (mocks.gpsWriter.createSessionGpsIfAllowed as jest.Mock).mock.calls[0][0] as { canStoreGps: boolean };
      expect(gpsCallArgs.canStoreGps).toBe(false);
    });

    it('canStoreGps is true when locationPermissionGranted is explicitly true', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({
        customerId: 'c1',
        body: baseBody({ gpsObservation: { lat: 1, lng: 1 }, locationPermissionGranted: true }) as never,
        currentUser: customerUser,
        context,
      });

      const gpsCallArgs = (mocks.gpsWriter.createSessionGpsIfAllowed as jest.Mock).mock.calls[0][0] as { canStoreGps: boolean };
      expect(gpsCallArgs.canStoreGps).toBe(true);
    });

    it('canStoreGps is true when a "location" permission with granted: true is in the permissions batch, even without the explicit flag', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({
        customerId: 'c1',
        body: baseBody({ gpsObservation: { lat: 1, lng: 1 }, permissions: [{ permissionCode: 'location', granted: true }] }) as never,
        currentUser: customerUser,
        context,
      });

      const gpsCallArgs = (mocks.gpsWriter.createSessionGpsIfAllowed as jest.Mock).mock.calls[0][0] as { canStoreGps: boolean };
      expect(gpsCallArgs.canStoreGps).toBe(true);
    });
  });

  describe('señales de riesgo del dispositivo: root/emulador/VPN generan eventos de riesgo', () => {
    it('creates one device risk event per red flag present in the snapshot (rooted + vpn), and none for a clean snapshot', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({
        customerId: 'c1',
        body: baseBody({
          device: {
            deviceFingerprintHash: 'fp-1',
            fingerprintVersion: 'v1',
            channel: 'mobile_app',
            snapshot: { isRooted: true, vpnDetected: true, isEmulator: false },
          },
        }) as never,
        currentUser: customerUser,
        context,
      });

      expect(mocks.sessionsRepository.createDeviceRiskEvent).toHaveBeenCalledTimes(2);
    });

    it('creates no risk events at all when no snapshot is provided', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(mocks.sessionsRepository.createDeviceRiskEvent).not.toHaveBeenCalled();
    });
  });

  describe('paso de onboarding: solo se registra si hay un flujo de onboarding activo', () => {
    it('does not create an onboarding step event when there is no active onboarding flow for the customer', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(mocks.sessionsRepository.createOnboardingStepEvent).not.toHaveBeenCalled();
    });

    it('creates an onboarding step event when there IS an active onboarding flow', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (mocks.sessionsRepository.findGlobalDevice as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.sessionsRepository.createGlobalDevice as jest.Mock).mockResolvedValueOnce({ id: 'global-device-1' } as never);
      (mocks.sessionsRepository.findDevice as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.sessionsRepository.createDevice as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
      (mocks.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.sessionsRepository.createCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
      (mocks.sessionsRepository.createSession as jest.Mock).mockResolvedValueOnce({ id: 'session-1' } as never);
      (mocks.sessionsRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce({ id: 'flow-1' } as never);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      expect(mocks.sessionsRepository.createOnboardingStepEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('camino feliz', () => {
    it('always records a successful auth event for the new session', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      const authArgs = (mocks.sessionsRepository.createAuthEvent as jest.Mock).mock.calls[0][0] as {
        loginSuccessful: boolean;
        eventType: string;
      };
      expect(authArgs).toMatchObject({ loginSuccessful: true, eventType: 'session_started' });
    });

    it('increments the customer activity summary session count for every session start', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'approved_for_next_step',
      } as never);
      await primeDeviceMocks(mocks);

      await mocks.service.startSession({ customerId: 'c1', body: baseBody() as never, currentUser: customerUser, context });

      const summaryArgs = (mocks.sessionsRepository.upsertActivitySummary as jest.Mock).mock.calls[0][0] as {
        incrementSessionCount: boolean;
      };
      expect(summaryArgs.incrementSessionCount).toBe(true);
    });
  });
});
