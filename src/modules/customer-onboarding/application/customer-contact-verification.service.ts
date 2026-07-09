import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../config/env.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { ContactVerificationRequestDto, ContactVerificationSubmitDto } from '../customer-onboarding.schemas.js';
import { assertCustomerOnboardingScope } from './customer-onboarding-access.util.js';

@Injectable()
export class CustomerContactVerificationService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async requestContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationRequestDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertCustomerOnboardingScope(input.customerId, input.currentUser);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    if (customer.lifecycleStatus === 'blocked') throw new UnprocessableEntityException('CUSTOMER_BLOCKED');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const contactMethod = await this.onboardingRepository.findCustomerContactMethod(
        input.tenantId,
        input.customerId,
        input.body.contactType,
        { transaction },
      );
      if (!contactMethod) throw new UnprocessableEntityException('CONTACT_NOT_REGISTERED');
      if (contactMethod.status === 'verified') throw new ConflictException('CONTACT_ALREADY_VERIFIED');

      const latestAttempt = await this.onboardingRepository.findLatestContactVerificationAttempt(input.tenantId, String(contactMethod.id), {
        transaction,
      });
      if (latestAttempt?.attemptedAt && now.getTime() - latestAttempt.attemptedAt.getTime() < 30_000) {
        throw new ConflictException('VERIFICATION_RATE_LIMITED');
      }

      const attempt = await this.onboardingRepository.createContactVerificationAttempt(
        {
          tenantId: input.tenantId,
          contactMethodId: String(contactMethod.id),
          verificationMethod: input.body.verificationChannel,
          verificationStatus: 'requested',
          confidenceScore: null,
          attemptedAt: now,
          verifiedAt: null,
          failureReasonCode: null,
        },
        { transaction },
      );

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'contact_verification_requested',
          eventType: 'requested',
          happenedAt: now,
          payloadJson: { contactType: input.body.contactType, verificationChannel: input.body.verificationChannel },
        },
        { transaction },
      );
      await this.onboardingRepository.createAuthEvent(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventType: 'contact_verification_requested',
          loginSuccessful: null,
          failureReasonCode: null,
          occurredAt: now,
          ipAddress: input.ipAddress,
        },
        { transaction },
      );
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'contact_verification_requested',
          screenName: 'contact_verification',
          payloadJson: { contactType: input.body.contactType, idempotencyKeyHash: sha256Hex(input.idempotencyKey) },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.contact_verification.request',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { contactType: input.body.contactType, attemptId: String(attempt.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        verificationAttemptId: String(attempt.id),
        contactType: input.body.contactType,
        deliveryStatus: 'accepted',
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      };
    });
  }

  async submitContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationSubmitDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertCustomerOnboardingScope(input.customerId, input.currentUser);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const contactMethod = await this.onboardingRepository.findCustomerContactMethod(
        input.tenantId,
        input.customerId,
        input.body.contactType,
        { transaction },
      );
      if (!contactMethod) throw new UnprocessableEntityException('CONTACT_NOT_REGISTERED');
      if (contactMethod.status === 'verified') throw new ConflictException('CONTACT_ALREADY_VERIFIED');

      const attempt = await this.onboardingRepository.findLatestContactVerificationAttempt(input.tenantId, String(contactMethod.id), {
        transaction,
      });
      if (!attempt) throw new NotFoundException('VERIFICATION_ATTEMPT_NOT_FOUND');
      if (attempt.attemptedAt && now.getTime() - attempt.attemptedAt.getTime() > 10 * 60_000) {
        await this.onboardingRepository.updateContactVerificationAttempt(
          attempt,
          { verificationStatus: 'expired', verifiedAt: null, failureReasonCode: 'expired', confidenceScore: null },
          { transaction },
        );
        throw new UnauthorizedException('VERIFICATION_CODE_EXPIRED');
      }

      // Development-safe placeholder: el proveedor real de OTP (envío por SMS/WhatsApp/email)
      // todavía no está implementado — `requestContactVerification` registra el intento pero no
      // despacha ningún código real. Antes, `verificationCode === '123456'` se aceptaba como
      // válido en CUALQUIER ambiente, incluida producción: cualquiera podía "verificar" el
      // contacto de cualquier cliente sin recibir jamás un código real. Se bloquea explícitamente
      // en producción (falla de forma ruidosa y clara en vez de aceptar en silencio un código fijo
      // conocido) hasta que exista una integración real de envío/validación de OTP. En
      // development/test se mantiene el atajo para smoke tests y pruebas locales.
      if (env.NODE_ENV === 'production') {
        throw new UnprocessableEntityException('CONTACT_VERIFICATION_OTP_PROVIDER_NOT_CONFIGURED');
      }
      if (input.body.verificationCode !== '123456') {
        await this.onboardingRepository.updateContactVerificationAttempt(
          attempt,
          { verificationStatus: 'failed', verifiedAt: null, failureReasonCode: 'invalid_code', confidenceScore: '0.00' },
          { transaction },
        );
        await this.onboardingRepository.createAuthEvent(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            sessionId: input.body.sessionId ?? null,
            deviceId: null,
            eventType: 'contact_verification_failed',
            loginSuccessful: false,
            failureReasonCode: 'invalid_code',
            occurredAt: now,
            ipAddress: input.ipAddress,
          },
          { transaction },
        );
        throw new UnauthorizedException('INVALID_VERIFICATION_CODE');
      }

      await this.onboardingRepository.updateContactVerificationAttempt(
        attempt,
        { verificationStatus: 'verified', verifiedAt: now, failureReasonCode: null, confidenceScore: '1.00' },
        { transaction },
      );
      await this.onboardingRepository.markContactMethodVerified(contactMethod, now, { transaction });
      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'contact_verified',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { contactType: input.body.contactType },
        },
        { transaction },
      );
      await this.onboardingRepository.createAuthEvent(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventType: 'contact_verification_succeeded',
          loginSuccessful: true,
          failureReasonCode: null,
          occurredAt: now,
          ipAddress: input.ipAddress,
        },
        { transaction },
      );
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'contact_verified',
          screenName: 'contact_verification',
          payloadJson: { contactType: input.body.contactType, idempotencyKeyHash: sha256Hex(input.idempotencyKey) },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.contact_verification.submit',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { contactType: input.body.contactType, attemptId: String(attempt.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        contactType: input.body.contactType,
        verificationStatus: 'verified',
        nextStep: 'identity_capture',
      };
    });
  }
}
