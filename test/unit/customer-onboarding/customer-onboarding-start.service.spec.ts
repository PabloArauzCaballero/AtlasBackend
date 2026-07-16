import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';

/**
 * ATLAS-P12d (extensión del plan más allá de las 11 módulos originales —
 * `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5): `CustomerOnboardingStartService`
 * es el flujo de registro real de un cliente nuevo — el archivo más grande de todo el proyecto
 * Escribe en 10+ tablas dentro de una única
 * transacción: cliente, credenciales, perfil, contactos, dispositivo, sesión, flujo de
 * onboarding, permisos, auditoría y consentimientos. Un error aquí no es un bug de UI — es un
 * registro de cliente corrupto, duplicado, o sin el consentimiento legal que se supone que tiene.
 */
jest.mock('../../../src/modules/customer-onboarding/customer-onboarding.mapper.js', () => ({
  toStartOnboardingResponse: jest.fn((input: { customer: { id: string }; session: { id: string } }) => ({
    customerId: input.customer.id,
    sessionId: input.session.id,
  })),
}));

describe('CustomerOnboardingStartService.startOnboarding', () => {
  async function buildService() {
    const { CustomerOnboardingStartService } =
      await import('../../../src/modules/customer-onboarding/application/customer-onboarding-start.service.js');

    const customersRepository = {
      findByContactHash: jest.fn(),
      createCustomer: jest.fn(),
      createProfileVersion: jest.fn(),
      updateCurrentProfileVersion: jest.fn(),
      createContactMethod: jest.fn(),
      createStatusEvent: jest.fn(),
    };
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
    };
    const consentsRepository = {
      findActiveDocumentById: jest.fn(),
      createCustomerConsent: jest.fn(),
      createConsentEvent: jest.fn(),
    };
    const onboardingRepository = {
      createOnboardingFlow: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
      createPermissionEvent: jest.fn(),
      createCustomerActionLog: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const authRepository = { createCredentials: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerOnboardingStartService(
      customersRepository as never,
      sessionsRepository as never,
      consentsRepository as never,
      onboardingRepository as never,
      authRepository as never,
      sequelize as never,
    );

    return { service, customersRepository, sessionsRepository, consentsRepository, onboardingRepository, authRepository };
  }

  function validInput(overrides: Record<string, unknown> = {}) {
    return {
      customer: { phone: '+59170000000', email: 'ana@example.com', firstName: 'Ana', lastName: 'Perez' },
      device: {
        deviceFingerprintHash: 'fp-hash-1',
        fingerprintVersion: 'v1',
        channel: 'mobile_app',
        userAgent: 'AtlasApp/1.0',
      },
      consents: [{ consentDocumentId: 'doc-1', purposeCode: 'terms', granted: true }],
      permissions: [],
      onboarding: {},
      ...overrides,
    } as never;
  }

  async function primeHappyPathMocks(mocks: Awaited<ReturnType<typeof buildService>>) {
    (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc-1' } as never);
    (mocks.customersRepository.createCustomer as jest.Mock).mockResolvedValueOnce({ id: 'customer-1' } as never);
    (mocks.customersRepository.createProfileVersion as jest.Mock).mockResolvedValueOnce({ id: 'profile-1' } as never);
    (mocks.sessionsRepository.findGlobalDevice as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createGlobalDevice as jest.Mock).mockResolvedValueOnce({ id: 'global-device-1' } as never);
    (mocks.sessionsRepository.findDevice as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createDevice as jest.Mock).mockResolvedValueOnce({ id: 'device-1' } as never);
    (mocks.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    (mocks.sessionsRepository.createCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link-1' } as never);
    (mocks.sessionsRepository.createSession as jest.Mock).mockResolvedValueOnce({ id: 'session-1' } as never);
    (mocks.onboardingRepository.createOnboardingFlow as jest.Mock).mockResolvedValueOnce({ id: 'flow-1' } as never);
    (mocks.consentsRepository.createCustomerConsent as jest.Mock).mockResolvedValue({ id: 'consent-1' } as never);
  }

  describe('guards antes de abrir la transacción', () => {
    it('throws BadRequestException without an idempotency key, before checking for duplicates', async () => {
      const mocks = await buildService();
      await expect(mocks.service.startOnboarding('t1', validInput(), null, '')).rejects.toThrow(BadRequestException);
      expect(mocks.customersRepository.findByContactHash).not.toHaveBeenCalled();
    });

    it('throws ConflictException CUSTOMER_ALREADY_EXISTS when a customer with the same phone/email hash already exists', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({ id: 'existing-customer' } as never);
      await expect(mocks.service.startOnboarding('t1', validInput(), null, 'idem-1')).rejects.toThrow(/CUSTOMER_ALREADY_EXISTS/);
      expect(mocks.customersRepository.createCustomer).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException REQUIRED_CONSENT_MISSING when any consent in the batch is not granted', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        mocks.service.startOnboarding(
          't1',
          validInput({ consents: [{ consentDocumentId: 'doc-1', purposeCode: 'terms', granted: false }] }),
          null,
          'idem-1',
        ),
      ).rejects.toThrow(/REQUIRED_CONSENT_MISSING/);
    });

    it('throws UnprocessableEntityException when a referenced consent document is not active/does not exist', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(mocks.service.startOnboarding('t1', validInput(), null, 'idem-1')).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.customersRepository.createCustomer).not.toHaveBeenCalled();
    });

    it('all consent documents are validated BEFORE the transaction opens — none of them are created if even one is invalid', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.consentsRepository.findActiveDocumentById as jest.Mock)
        .mockResolvedValueOnce({ id: 'doc-1' } as never)
        .mockResolvedValueOnce(null as never);

      await expect(
        mocks.service.startOnboarding(
          't1',
          validInput({
            consents: [
              { consentDocumentId: 'doc-1', purposeCode: 'terms', granted: true },
              { consentDocumentId: 'doc-2', purposeCode: 'marketing', granted: true },
            ],
          }),
          null,
          'idem-1',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.consentsRepository.createCustomerConsent).not.toHaveBeenCalled();
    });
  });

  describe('condición de carrera: UniqueConstraintError se traduce al mismo error de negocio', () => {
    it('a UniqueConstraintError thrown mid-transaction is caught and re-thrown as ConflictException CUSTOMER_ALREADY_EXISTS', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValueOnce({ id: 'doc-1' } as never);
      (mocks.customersRepository.createCustomer as jest.Mock).mockRejectedValueOnce(
        new UniqueConstraintError({ message: 'duplicate' }) as never,
      );

      await expect(mocks.service.startOnboarding('t1', validInput(), null, 'idem-1')).rejects.toThrow(ConflictException);
    });

    it('any OTHER error type is propagated unchanged, not swallowed into CUSTOMER_ALREADY_EXISTS', async () => {
      const mocks = await buildService();
      (mocks.customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce(null as never);
      (mocks.consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValueOnce({ id: 'doc-1' } as never);
      (mocks.customersRepository.createCustomer as jest.Mock).mockRejectedValueOnce(new Error('connection lost') as never);

      await expect(mocks.service.startOnboarding('t1', validInput(), null, 'idem-1')).rejects.toThrow('connection lost');
    });
  });

  describe('resolución de dispositivo: crear vs reusar, en 3 niveles independientes', () => {
    it('creates a new global device, tenant device, and customer-device link when none exist yet', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.sessionsRepository.createGlobalDevice).toHaveBeenCalledTimes(1);
      expect(mocks.sessionsRepository.createDevice).toHaveBeenCalledTimes(1);
      expect(mocks.sessionsRepository.createCustomerDeviceLink).toHaveBeenCalledTimes(1);
      expect(mocks.sessionsRepository.touchGlobalDevice).not.toHaveBeenCalled();
    });

    it('touches (does not re-create) an existing global device fingerprint, even for a brand-new customer', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);
      (mocks.sessionsRepository.findGlobalDevice as jest.Mock).mockReset().mockResolvedValueOnce({ id: 'existing-global-device' } as never);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.sessionsRepository.createGlobalDevice).not.toHaveBeenCalled();
      expect(mocks.sessionsRepository.touchGlobalDevice).toHaveBeenCalledTimes(1);
    });

    it('reuses an existing customer-device link instead of creating a duplicate one', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);
      (mocks.sessionsRepository.findCustomerDeviceLink as jest.Mock).mockReset().mockResolvedValueOnce({ id: 'existing-link' } as never);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.sessionsRepository.createCustomerDeviceLink).not.toHaveBeenCalled();
    });

    it('touches the customer-device link with the new session id after creating the session, regardless of whether the link was new or existing', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      const touchArgs = (mocks.sessionsRepository.touchCustomerDeviceLink as jest.Mock).mock.calls[0];
      expect(touchArgs[1]).toBe('session-1');
    });
  });

  describe('métodos de contacto: phone es primario por defecto, email solo si no hay phone', () => {
    it('creates a phone contact method marked isPrimary: true when a phone is given', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding(
        't1',
        validInput({ customer: { phone: '+59170000000', email: 'ana@example.com' } }),
        null,
        'idem-1',
      );

      const phoneCallArgs = (mocks.customersRepository.createContactMethod as jest.Mock).mock.calls.find(
        (c) => (c[0] as { contactType: string }).contactType === 'phone',
      )?.[0] as { isPrimary: boolean };
      expect(phoneCallArgs.isPrimary).toBe(true);
    });

    it('marks the email contact method as isPrimary: true ONLY when there is no phone at all', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput({ customer: { email: 'ana@example.com' } }), null, 'idem-1');

      const emailCallArgs = (mocks.customersRepository.createContactMethod as jest.Mock).mock.calls.find(
        (c) => (c[0] as { contactType: string }).contactType === 'email',
      )?.[0] as { isPrimary: boolean };
      expect(emailCallArgs.isPrimary).toBe(true);
    });

    it('marks the email contact method as isPrimary: false when a phone is also present', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding(
        't1',
        validInput({ customer: { phone: '+59170000000', email: 'ana@example.com' } }),
        null,
        'idem-1',
      );

      const emailCallArgs = (mocks.customersRepository.createContactMethod as jest.Mock).mock.calls.find(
        (c) => (c[0] as { contactType: string }).contactType === 'email',
      )?.[0] as { isPrimary: boolean };
      expect(emailCallArgs.isPrimary).toBe(false);
    });

    it('creates no contact method at all for a channel with neither phone nor email', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput({ customer: {} }), null, 'idem-1');

      expect(mocks.customersRepository.createContactMethod).not.toHaveBeenCalled();
    });
  });

  describe('captura de snapshot de dispositivo: solo si el cliente lo envía', () => {
    it('does not create a device snapshot when none is provided in the request', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.sessionsRepository.createDeviceSnapshot).not.toHaveBeenCalled();
    });

    it('creates a device snapshot when the client provides one', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding(
        't1',
        validInput({
          device: {
            deviceFingerprintHash: 'fp-hash-1',
            fingerprintVersion: 'v1',
            channel: 'mobile_app',
            snapshot: { brand: 'Samsung', model: 'A54', osFamily: 'android', isRooted: false },
          },
        }),
        null,
        'idem-1',
      );

      expect(mocks.sessionsRepository.createDeviceSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe('permisos y consentimientos: uno por cada elemento del batch', () => {
    it('records one permission event per item in the permissions array', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding(
        't1',
        validInput({
          permissions: [
            { permissionCode: 'location', granted: true },
            { permissionCode: 'camera', granted: false },
          ],
        }),
        null,
        'idem-1',
      );

      expect(mocks.onboardingRepository.createPermissionEvent).toHaveBeenCalledTimes(2);
    });

    it('records a consent + a consent event for every consent in the batch, with eventType matching granted/declined', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);
      (mocks.consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc-1' } as never);

      await mocks.service.startOnboarding(
        't1',
        validInput({
          consents: [{ consentDocumentId: 'doc-1', purposeCode: 'terms', granted: true }],
        }),
        null,
        'idem-1',
      );

      expect(mocks.consentsRepository.createCustomerConsent).toHaveBeenCalledTimes(1);
      const eventArgs = (mocks.consentsRepository.createConsentEvent as jest.Mock).mock.calls[0][0] as { eventType: string };
      expect(eventArgs.eventType).toBe('granted');
    });
  });

  describe('camino feliz — orquestación completa', () => {
    it('creates credentials only when a password is supplied', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.authRepository.createCredentials).not.toHaveBeenCalled();
    });

    it('creates credentials with a hashed password when one is supplied', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput({ password: 'a-real-password-123' }), null, 'idem-1');

      expect(mocks.authRepository.createCredentials).toHaveBeenCalledTimes(1);
      const credArgs = (mocks.authRepository.createCredentials as jest.Mock).mock.calls[0][0] as { passwordHash: string };
      expect(credArgs.passwordHash).not.toBe('a-real-password-123');
      expect(credArgs.passwordHash.length).toBeGreaterThan(20);
    }, 10_000);

    it('returns the mapped response with the customer and session ids from the transaction', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      const result = await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(result).toEqual({ customerId: 'customer-1', sessionId: 'session-1' });
    });

    it('writes exactly one initial status event ("registered") per new customer', async () => {
      const mocks = await buildService();
      await primeHappyPathMocks(mocks);

      await mocks.service.startOnboarding('t1', validInput(), null, 'idem-1');

      expect(mocks.customersRepository.createStatusEvent).toHaveBeenCalledTimes(1);
      const statusArgs = (mocks.customersRepository.createStatusEvent as jest.Mock).mock.calls[0][0] as {
        newStatus: string;
        previousStatus: unknown;
      };
      expect(statusArgs).toMatchObject({ newStatus: 'registered', previousStatus: null });
    });
  });
});
