import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerContactVerificationService } from '../../../src/modules/customer-onboarding/application/customer-contact-verification.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `CustomerContactVerificationService` (269 líneas) — el flujo de verificación de teléfono/email
 * por código (OTP). Tres reglas de negocio reales conviven aquí: rate limiting (30s entre
 * solicitudes), expiración del código (10 min), y un código de desarrollo hardcodeado
 * (`'123456'`) documentado explícitamente en el propio código como "placeholder mientras no
 * exista un proveedor real de OTP".
 *
 * Auditoría de producción (ver docs/audit/customer-onboarding.md, hallazgo 1): el placeholder
 * se aceptaba en CUALQUIER ambiente, incluida producción — un bypass real de verificación de
 * contacto. Ahora está bloqueado explícitamente cuando `env.NODE_ENV === 'production'` (test
 * dedicado al final de `submitContactVerification`); en development/test el atajo se mantiene
 * sin cambios para smoke tests locales, y los tests de este archivo corren con `NODE_ENV=test`.
 */
describe('CustomerContactVerificationService', () => {
  function buildService() {
    const customersRepository = { findById: jest.fn() };
    const onboardingRepository = {
      findCustomerContactMethod: jest.fn(),
      findLatestContactVerificationAttempt: jest.fn(),
      createContactVerificationAttempt: jest.fn(),
      updateContactVerificationAttempt: jest.fn(),
      markContactMethodVerified: jest.fn(),
      findLatestOnboardingFlow: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
      createAuthEvent: jest.fn(),
      createCustomerActionLog: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CustomerContactVerificationService(customersRepository as never, onboardingRepository as never, sequelize as never);
    return { service, customersRepository, onboardingRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  describe('requestContactVerification', () => {
    function baseInput(overrides: Record<string, unknown> = {}) {
      return {
        tenantId: 't1',
        customerId: 'c1',
        body: { contactType: 'phone', verificationChannel: 'sms' } as never,
        currentUser: customerUser,
        ipAddress: '10.0.0.1',
        idempotencyKey: 'idem-1',
        ...overrides,
      };
    }

    it('throws BadRequestException without an idempotency key', async () => {
      const { service } = buildService();
      await expect(service.requestContactVerification(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when a customer token requests verification for a different customerId', async () => {
      const { service } = buildService();
      await expect(service.requestContactVerification(baseInput({ customerId: 'someone-else' }))).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException CUSTOMER_BLOCKED for a blocked customer', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'blocked' } as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/CUSTOMER_BLOCKED/);
    });

    it('throws CONTACT_NOT_REGISTERED when the customer has no contact method of that type', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/CONTACT_NOT_REGISTERED/);
    });

    it('throws ConflictException CONTACT_ALREADY_VERIFIED when the contact is already verified', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'verified' } as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/CONTACT_ALREADY_VERIFIED/);
    });

    it('throws ConflictException VERIFICATION_RATE_LIMITED when the last attempt was less than 30 seconds ago', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        attemptedAt: new Date(Date.now() - 5_000),
      } as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/VERIFICATION_RATE_LIMITED/);
      expect(onboardingRepository.createContactVerificationAttempt).not.toHaveBeenCalled();
    });

    it('allows a new attempt once at least 30 seconds have passed since the last one', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        attemptedAt: new Date(Date.now() - 31_000),
      } as never);
      (onboardingRepository.createContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
      (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.requestContactVerification(baseInput());

      expect(result.deliveryStatus).toBe('accepted');
    });

    it('sets expiresAt to exactly 10 minutes after the request is accepted', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce(null as never);
      (onboardingRepository.createContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
      (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

      const before = Date.now();
      const result = await service.requestContactVerification(baseInput());
      const expiresAtMs = new Date(result.expiresAt).getTime();

      expect(expiresAtMs - before).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
      expect(expiresAtMs - before).toBeLessThanOrEqual(10 * 60_000 + 1000);
    });
  });

  describe('submitContactVerification', () => {
    function baseInput(overrides: Record<string, unknown> = {}) {
      return {
        tenantId: 't1',
        customerId: 'c1',
        body: { contactType: 'phone', verificationCode: '123456' } as never,
        currentUser: customerUser,
        ipAddress: '10.0.0.1',
        idempotencyKey: 'idem-1',
        ...overrides,
      };
    }

    it('throws BadRequestException without an idempotency key', async () => {
      const { service } = buildService();
      await expect(service.submitContactVerification(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
    });

    it('throws CONTACT_NOT_REGISTERED when there is no contact method of that type', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.submitContactVerification(baseInput())).rejects.toThrow(/CONTACT_NOT_REGISTERED/);
    });

    it('throws ConflictException CONTACT_ALREADY_VERIFIED when already verified — before even checking the code', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'verified' } as never);
      await expect(service.submitContactVerification(baseInput())).rejects.toThrow(ConflictException);
      expect(onboardingRepository.findLatestContactVerificationAttempt).not.toHaveBeenCalled();
    });

    it('throws NotFoundException VERIFICATION_ATTEMPT_NOT_FOUND when no verification was ever requested', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.submitContactVerification(baseInput())).rejects.toThrow(/VERIFICATION_ATTEMPT_NOT_FOUND/);
    });

    it('throws UnauthorizedException VERIFICATION_CODE_EXPIRED after 10 minutes, and marks the attempt as "expired" as a side effect', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        id: 'attempt-1',
        attemptedAt: new Date(Date.now() - 11 * 60_000),
      } as never);

      await expect(service.submitContactVerification(baseInput())).rejects.toThrow(UnauthorizedException);

      const updateArgs = (onboardingRepository.updateContactVerificationAttempt as jest.Mock).mock.calls[0][1] as {
        verificationStatus: string;
      };
      expect(updateArgs.verificationStatus).toBe('expired');
    });

    it('a correct code just under the 10-minute mark is still accepted', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        id: 'attempt-1',
        attemptedAt: new Date(Date.now() - 9 * 60_000),
      } as never);
      (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.submitContactVerification(baseInput());

      expect(result.verificationStatus).toBe('verified');
    });

    it('throws UnauthorizedException INVALID_VERIFICATION_CODE for any code other than the dev placeholder "123456", and records a failed attempt + auth event', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({ id: 'contact-1', status: 'pending' } as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        id: 'attempt-1',
        attemptedAt: new Date(),
      } as never);

      await expect(
        service.submitContactVerification(baseInput({ body: { contactType: 'phone', verificationCode: '000000' } })),
      ).rejects.toThrow(/INVALID_VERIFICATION_CODE/);

      const updateArgs = (onboardingRepository.updateContactVerificationAttempt as jest.Mock).mock.calls[0][1] as {
        verificationStatus: string;
      };
      expect(updateArgs.verificationStatus).toBe('failed');
      const authArgs = (onboardingRepository.createAuthEvent as jest.Mock).mock.calls[0][0] as {
        loginSuccessful: boolean;
        failureReasonCode: string;
      };
      expect(authArgs).toMatchObject({ loginSuccessful: false, failureReasonCode: 'invalid_code' });
      expect(onboardingRepository.markContactMethodVerified).not.toHaveBeenCalled();
    });

    it('marks the contact method verified and returns nextStep "identity_capture" on a correct code', async () => {
      const { service, customersRepository, onboardingRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      const contactMethod = { id: 'contact-1', status: 'pending' };
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(contactMethod as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        id: 'attempt-1',
        attemptedAt: new Date(),
      } as never);
      (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await service.submitContactVerification(baseInput());

      expect(onboardingRepository.markContactMethodVerified).toHaveBeenCalledWith(contactMethod, expect.any(Date), { transaction: {} });
      expect(result).toMatchObject({ verificationStatus: 'verified', nextStep: 'identity_capture' });
    });

    it('rejects the dev placeholder "123456" in production, even though it is a syntactically correct code (regression)', async () => {
      // Antes de este fix, `'123456'` se aceptaba como OTP válido en CUALQUIER ambiente,
      // incluida producción — un bypass real de verificación de contacto. Ahora, en
      // producción, el atajo de desarrollo debe estar completamente bloqueado.
      const { env } = await import('../../../src/config/env.js');
      const originalNodeEnv = env.NODE_ENV;
      env.NODE_ENV = 'production';
      try {
        const { service, customersRepository, onboardingRepository } = buildService();
        (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
        (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({
          id: 'contact-1',
          status: 'pending',
        } as never);
        (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
          id: 'attempt-1',
          attemptedAt: new Date(),
        } as never);

        await expect(service.submitContactVerification(baseInput())).rejects.toThrow(/CONTACT_VERIFICATION_OTP_PROVIDER_NOT_CONFIGURED/);
        expect(onboardingRepository.markContactMethodVerified).not.toHaveBeenCalled();
      } finally {
        env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});
