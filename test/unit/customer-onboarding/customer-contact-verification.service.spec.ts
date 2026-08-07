import { describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CustomerContactVerificationService } from '../../../src/modules/customer-onboarding/application/customer-contact-verification.service.js';

/**
 * Verificación de contacto con OTP REAL.
 *
 * Este flujo era un placeholder: `request` registraba el intento sin llamar a ningún proveedor y
 * `submit` aceptaba el literal `'123456'`. Una auditoría previa encontró que ese atajo estaba activo
 * en cualquier ambiente y lo bloqueó en producción con un 422, lo que dejó el onboarding
 * inutilizable fuera de desarrollo.
 *
 * Ahora el código lo emite y valida `ContactVerificationCodeService` contra `auth_one_time_codes`, y
 * la entrega ocurre por el canal elegido. Estos tests fijan el contrato resultante.
 */
describe('CustomerContactVerificationService', () => {
  function buildService() {
    const customersRepository = { findById: jest.fn(async (..._args: unknown[]) => ({ id: 'c1', lifecycleStatus: 'registered' })) };
    const onboardingRepository = {
      findCustomerContactMethod: jest.fn(async (..._args: unknown[]) => ({ id: 'contact-1', status: 'pending' })),
      findLatestContactVerificationAttempt: jest.fn(async (..._args: unknown[]) => null),
      createContactVerificationAttempt: jest.fn(async (..._args: unknown[]) => ({ id: 'attempt-1' })),
      updateContactVerificationAttempt: jest.fn(),
      markContactMethodVerified: jest.fn(),
    };
    const lifecycleService = { advance: jest.fn(), transition: jest.fn() };
    const codeService = {
      assertChannelAvailable: jest.fn(),
      issueAndDeliver: jest.fn(async (..._args: unknown[]) => ({ delivered: true, provider: 'twilio_sms', errorCode: null })),
      verify: jest.fn(async (..._args: unknown[]) => ({ ok: true })),
    };
    const journal = { recordRequested: jest.fn(), recordFailure: jest.fn(), recordVerified: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerContactVerificationService(
      customersRepository as never,
      onboardingRepository as never,
      lifecycleService as never,
      codeService as never,
      journal as never,
      sequelize as never,
    );
    return { service, customersRepository, onboardingRepository, lifecycleService, codeService, journal };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

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

  describe('requestContactVerification', () => {
    it('exige clave de idempotencia y ownership antes de cualquier lectura', async () => {
      const { service } = buildService();
      await expect(service.requestContactVerification(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
      await expect(service.requestContactVerification(baseInput({ customerId: 'otro' }))).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException cuando el cliente no existe', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(NotFoundException);
    });

    it('rechaza a un cliente bloqueado', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'blocked' } as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/CUSTOMER_BLOCKED/);
    });

    /**
     * Se comprueba ANTES de tocar la base: registrar un intento por un canal que nadie puede
     * despachar deja al cliente esperando un código que jamás se envió.
     */
    it('falla ruidosamente si el canal pedido no tiene proveedor configurado, sin registrar el intento', async () => {
      const { service, codeService, onboardingRepository } = buildService();
      (codeService.assertChannelAvailable as jest.Mock).mockImplementationOnce(() => {
        throw new ServiceUnavailableException('VERIFICATION_CHANNEL_UNAVAILABLE: sms');
      });
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/VERIFICATION_CHANNEL_UNAVAILABLE/);
      expect(onboardingRepository.createContactVerificationAttempt).not.toHaveBeenCalled();
    });

    it('rechaza si el contacto no está registrado o ya está verificado', async () => {
      const first = buildService();
      (first.onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(first.service.requestContactVerification(baseInput())).rejects.toThrow(/CONTACT_NOT_REGISTERED/);

      const second = buildService();
      (second.onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({
        id: 'contact-1',
        status: 'verified',
      } as never);
      await expect(second.service.requestContactVerification(baseInput())).rejects.toThrow(ConflictException);
    });

    it('aplica el cooldown de 30 s entre reenvíos', async () => {
      const { service, onboardingRepository, codeService } = buildService();
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        attemptedAt: new Date(Date.now() - 5_000),
      } as never);
      await expect(service.requestContactVerification(baseInput())).rejects.toThrow(/VERIFICATION_RATE_LIMITED/);
      expect(codeService.issueAndDeliver).not.toHaveBeenCalled();
    });

    it('permite un intento nuevo pasados los 30 s', async () => {
      const { service, onboardingRepository, codeService } = buildService();
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({
        attemptedAt: new Date(Date.now() - 45_000),
      } as never);
      await expect(service.requestContactVerification(baseInput())).resolves.toMatchObject({ deliveryStatus: 'sent' });
      expect(codeService.issueAndDeliver).toHaveBeenCalledTimes(1);
    });

    /** Regresión: antes se respondía `accepted` fijo sin haber llamado a ningún proveedor. */
    it('emite y entrega un código real, y refleja el resultado de la entrega en la respuesta', async () => {
      const { service, codeService, onboardingRepository, journal } = buildService();

      const result = await service.requestContactVerification(baseInput());

      expect(codeService.issueAndDeliver).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', customerId: 'c1', contactType: 'phone', channel: 'sms' }),
      );
      expect(result).toMatchObject({ verificationAttemptId: 'attempt-1', deliveryStatus: 'sent' });
      expect((onboardingRepository.createContactVerificationAttempt as jest.Mock).mock.calls[0][0]).toMatchObject({
        verificationStatus: 'requested',
        failureReasonCode: null,
      });
      expect(journal.recordRequested).toHaveBeenCalled();
    });

    it('registra el intento como delivery_failed cuando el proveedor no pudo entregar', async () => {
      const { service, codeService, onboardingRepository } = buildService();
      (codeService.issueAndDeliver as jest.Mock).mockResolvedValueOnce({
        delivered: false,
        provider: 'twilio_sms',
        errorCode: 'TWILIO_SMS_SEND_FAILED',
      } as never);

      const result = await service.requestContactVerification(baseInput());

      expect(result.deliveryStatus).toBe('delivery_failed');
      expect((onboardingRepository.createContactVerificationAttempt as jest.Mock).mock.calls[0][0]).toMatchObject({
        verificationStatus: 'delivery_failed',
        failureReasonCode: 'TWILIO_SMS_SEND_FAILED',
      });
    });
  });

  describe('submitContactVerification', () => {
    const submitInput = (overrides: Record<string, unknown> = {}) =>
      baseInput({ body: { contactType: 'phone', verificationChannel: 'sms', verificationCode: '123456' } as never, ...overrides });

    it('rechaza si el contacto ya está verificado, antes siquiera de mirar el código', async () => {
      const { service, onboardingRepository, codeService } = buildService();
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce({
        id: 'contact-1',
        status: 'verified',
      } as never);
      await expect(service.submitContactVerification(submitInput())).rejects.toThrow(ConflictException);
      expect(codeService.verify).not.toHaveBeenCalled();
    });

    it('lanza VERIFICATION_ATTEMPT_NOT_FOUND cuando nunca se pidió un código', async () => {
      const { service, onboardingRepository } = buildService();
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.submitContactVerification(submitInput())).rejects.toThrow(NotFoundException);
    });

    /**
     * Regresión del hallazgo crítico: `'123456'` era el código de desarrollo aceptado en cualquier
     * ambiente. Ahora no tiene ningún significado especial — se valida contra el código emitido.
     */
    it('rechaza un código incorrecto y registra el intento fallido, sin importar cuál sea el literal', async () => {
      const { service, onboardingRepository, codeService, journal } = buildService();
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
      (codeService.verify as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'invalid' } as never);

      await expect(service.submitContactVerification(submitInput())).rejects.toThrow(UnauthorizedException);
      expect((onboardingRepository.updateContactVerificationAttempt as jest.Mock).mock.calls[0][1]).toMatchObject({
        verificationStatus: 'failed',
        failureReasonCode: 'invalid_code',
      });
      expect(journal.recordFailure).toHaveBeenCalledWith(expect.anything(), { failureReasonCode: 'invalid_code' });
      expect(onboardingRepository.markContactMethodVerified).not.toHaveBeenCalled();
    });

    it('traduce un código vencido a VERIFICATION_CODE_EXPIRED', async () => {
      const { service, onboardingRepository, codeService } = buildService();
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
      (codeService.verify as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'expired' } as never);
      await expect(service.submitContactVerification(submitInput())).rejects.toThrow(/VERIFICATION_CODE_EXPIRED/);
    });

    it('con el código correcto: marca verificado, avanza el estado y devuelve nextStep personal_data', async () => {
      const { service, onboardingRepository, lifecycleService, journal } = buildService();
      const contactMethod = { id: 'contact-1', status: 'pending' };
      (onboardingRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(contactMethod as never);
      (onboardingRepository.findLatestContactVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);

      const result = await service.submitContactVerification(submitInput());

      expect(onboardingRepository.markContactMethodVerified).toHaveBeenCalledWith(contactMethod, expect.any(Date), { transaction: {} });
      // Verificar el contacto es el evento que abre el resto del onboarding: antes no cambiaba nada.
      expect(lifecycleService.advance).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'onboarding_in_progress', reasonCode: 'contact_verified' }),
      );
      expect(journal.recordVerified).toHaveBeenCalled();
      expect(result).toMatchObject({ verificationStatus: 'verified', nextStep: 'personal_data' });
    });
  });
});
