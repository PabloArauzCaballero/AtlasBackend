import { describe, expect, it, jest } from '@jest/globals';
import { SessionsRepository } from '../../../src/modules/sessions/sessions.repository.js';

/**
 * ATLAS-P11-T06 (derisks ATLAS-P11-T12): `SessionsRepository` pasó de ser un único archivo de
 * 857 líneas a una fachada delgada que delega en 6 repositorios especializados. Ese es
 * exactamente el tipo de refactor mecánico donde es fácil cometer un error silencioso —
 * delegar en el sub-repositorio equivocado, invertir el orden de argumentos, olvidar pasar
 * `options` — que ningún test de negocio existente habría detectado, porque el comportamiento
 * observable a través de la fachada es idéntico esté bien o mal cableado (hasta que se ejecuta
 * en runtime). Este test no valida lógica de negocio (eso vive en los repositorios
 * especializados); valida específicamente que el cableado de la fachada es correcto.
 */
describe('SessionsRepository (facade)', () => {
  function buildFacade() {
    const deviceRepository = {
      findGlobalDevice: jest.fn(),
      createDevice: jest.fn(),
      touchDevice: jest.fn(),
      findDeviceRiskEvents: jest.fn(),
    };
    const lifecycleRepository = {
      createSession: jest.fn(),
      endSession: jest.fn(),
      findLatestActiveSession: jest.fn(),
    };
    const locationRepository = {
      findCurrentAddressContext: jest.fn(),
      createGpsObservation: jest.fn(),
    };
    const telemetryRepository = {
      createAuthEvent: jest.fn(),
      findSessionSimObservations: jest.fn(),
    };
    const onboardingLinkRepository = {
      findLatestOnboardingFlow: jest.fn(),
    };
    const activityAuditRepository = {
      upsertActivitySummary: jest.fn(),
      createAudit: jest.fn(),
    };

    const facade = new SessionsRepository(
      deviceRepository as never,
      lifecycleRepository as never,
      locationRepository as never,
      telemetryRepository as never,
      onboardingLinkRepository as never,
      activityAuditRepository as never,
    );

    return {
      facade,
      deviceRepository,
      lifecycleRepository,
      locationRepository,
      telemetryRepository,
      onboardingLinkRepository,
      activityAuditRepository,
    };
  }

  it('delegates device methods to SessionsDeviceRepository with the exact same arguments', async () => {
    const { facade, deviceRepository } = buildFacade();
    const options = { transaction: undefined };

    await facade.findGlobalDevice('fp-1', 'v1', options);
    expect(deviceRepository.findGlobalDevice).toHaveBeenCalledWith('fp-1', 'v1', options);

    await facade.touchDevice({ id: 'd1' } as never, new Date('2026-01-01'), options);
    expect(deviceRepository.touchDevice).toHaveBeenCalledWith({ id: 'd1' }, new Date('2026-01-01'), options);
  });

  it('delegates lifecycle methods to SessionsLifecycleRepository, not to any other sub-repository', async () => {
    const { facade, lifecycleRepository, deviceRepository } = buildFacade();
    const values = {
      tenantId: 't1',
      customerId: 'c1',
      deviceId: 'd1',
      sessionTokenHash: 'hash',
      channel: 'mobile_app',
      authMethod: 'password',
      ipAddress: null,
      userAgent: null,
      gpsLat: null,
      gpsLng: null,
      gpsAccuracyMeters: null,
      now: new Date('2026-01-01'),
    };

    await facade.createSession(values, {});
    expect(lifecycleRepository.createSession).toHaveBeenCalledWith(values, {});
    expect(deviceRepository.createDevice).not.toHaveBeenCalled();
  });

  it('delegates address/GPS methods to SessionsLocationRepository', async () => {
    const { facade, locationRepository } = buildFacade();
    await facade.findCurrentAddressContext('t1', 'c1', {});
    expect(locationRepository.findCurrentAddressContext).toHaveBeenCalledWith('t1', 'c1', {});
  });

  it('delegates telemetry methods to SessionsTelemetryRepository', async () => {
    const { facade, telemetryRepository } = buildFacade();
    await facade.findSessionSimObservations('t1', 's1', 5);
    expect(telemetryRepository.findSessionSimObservations).toHaveBeenCalledWith('t1', 's1', 5);
  });

  it('delegates onboarding-link methods to SessionsOnboardingLinkRepository', async () => {
    const { facade, onboardingLinkRepository } = buildFacade();
    await facade.findLatestOnboardingFlow('t1', 'c1', {});
    expect(onboardingLinkRepository.findLatestOnboardingFlow).toHaveBeenCalledWith('t1', 'c1', {});
  });

  it('delegates activity summary and audit methods to SessionsActivityAuditRepository', async () => {
    const { facade, activityAuditRepository } = buildFacade();
    const values = { tenantId: 't1', customerId: 'c1', deviceId: 'd1', now: new Date('2026-01-01'), incrementSessionCount: true };
    await facade.upsertActivitySummary(values, {});
    expect(activityAuditRepository.upsertActivitySummary).toHaveBeenCalledWith(values, {});
  });

  it('propagates the return value from the delegated call unchanged', async () => {
    const { facade, deviceRepository } = buildFacade();
    const expected = { id: 'device-42' };
    (deviceRepository.findDeviceRiskEvents as jest.Mock).mockResolvedValueOnce([expected] as never);
    const result = await facade.findDeviceRiskEvents('t1', 'd1', 5);
    expect(result).toEqual([expected]);
  });
});
