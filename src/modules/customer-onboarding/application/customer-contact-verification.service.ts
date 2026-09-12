/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
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
import { Transaction } from 'sequelize';
import { env } from '../../../config/env.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { ContactVerificationRequestDto, ContactVerificationSubmitDto } from '../customer-onboarding.schemas.js';
import { ContactVerificationCodeService } from './contact-verification-code.service.js';
import { ContactVerificationJournalService } from './contact-verification-journal.service.js';
import { ContactMethodResolutionService } from './contact-method-resolution.service.js';

/** Vigencia del código, alineada con la del emisor (`AUTH_ONE_TIME_CODE_TTL_MINUTES`). */
const TTL_MS = env.AUTH_ONE_TIME_CODE_TTL_MINUTES * 60_000;
/** Reenvío: un código nuevo cada 30 s como máximo, por contacto. */
const RESEND_COOLDOWN_MS = 30_000;

type FlowInput = {
  tenantId: string;
  customerId: string;
  currentUser: AuthenticatedUser;
  ipAddress: string | null;
  idempotencyKey: string;
};

/**
 * Verificación del teléfono/correo declarado por el cliente.
 *
 * Es la pieza que prueba que el cliente controla el contacto que declaró — el eslabón central de la
 * cadena KYC del onboarding. Hasta ahora era un placeholder: `request` registraba el intento sin
 * llamar a ningún proveedor y `submit` aceptaba el literal `'123456'`, con un bloqueo explícito en
 * producción que dejaba el flujo inutilizable fuera de desarrollo.
 *
 * Ahora el código lo emite y valida `ContactVerificationCodeService` contra `auth_one_time_codes`
 * (hash, vigencia, intentos, consumo) y la entrega ocurre por el canal elegido.
 */
@Injectable()
export class CustomerContactVerificationService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly codeService: ContactVerificationCodeService,
    private readonly journal: ContactVerificationJournalService,
    private readonly contactResolution: ContactMethodResolutionService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async requestContactVerification(input: FlowInput & { body: ContactVerificationRequestDto }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    if (customer.lifecycleStatus === 'blocked') throw new UnprocessableEntityException('CUSTOMER_BLOCKED');

    // Se comprueba ANTES de tocar la base: registrar un intento por un canal que nadie puede
    // despachar deja al cliente esperando un código que jamás se envió.
    this.codeService.assertChannelAvailable(input.body.verificationChannel);

    const now = new Date();

    // La transacción cubre EMISIÓN + intento + bitácora, y termina antes de hablar con el proveedor.
    // Antes el código se creaba fuera de ella: un rollback dejaba un código vigente sin intento
    // asociado, y el `submit` siguiente respondía `VERIFICATION_ATTEMPT_NOT_FOUND` sobre un código
    // que el cliente sí tenía. Entregar dentro tampoco vale: mantendría locks abiertos durante toda
    // la latencia del proveedor, y un SMS ya enviado no se deshace con la transacción.
    const issuedContext = await this.sequelize.transaction(async (transaction) => {
      const contactMethod = await this.contactResolution.resolve({
        tenantId: input.tenantId,
        customerId: input.customerId,
        contactType: input.body.contactType,
        contactMethodId: input.body.contactMethodId,
        transaction,
      });
      if (contactMethod.status === 'verified') throw new ConflictException('CONTACT_ALREADY_VERIFIED');

      const latestAttempt = await this.onboardingRepository.findLatestContactVerificationAttempt(input.tenantId, String(contactMethod.id), {
        transaction,
      });
      if (latestAttempt?.attemptedAt && now.getTime() - latestAttempt.attemptedAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new ConflictException('VERIFICATION_RATE_LIMITED');
      }

      const issued = await this.codeService.issue({
        tenantId: input.tenantId,
        customerId: input.customerId,
        contactMethod,
        contactType: input.body.contactType,
        transaction,
      });

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

      await this.journal.recordRequested(this.contextOf(input, now, transaction, input.body.contactType), {
        verificationChannel: input.body.verificationChannel,
        attemptId: String(attempt.id),
        contactMethodId: String(contactMethod.id),
      });

      return { attempt, contactMethodId: String(contactMethod.id), issued };
    });

    const delivery = await this.codeService.deliverIssuedCode({
      tenantId: input.tenantId,
      customerId: input.customerId,
      channel: input.body.verificationChannel,
      issued: issuedContext.issued,
    });

    if (!delivery.delivered) {
      // El intento ya está comprometido; lo que cambia es su desenlace. Se corrige en su propia
      // transacción para no reabrir la anterior, que ya cerró bien.
      await this.sequelize.transaction((transaction) =>
        this.onboardingRepository.updateContactVerificationAttempt(
          issuedContext.attempt,
          { verificationStatus: 'delivery_failed', verifiedAt: null, failureReasonCode: delivery.errorCode, confidenceScore: null },
          { transaction },
        ),
      );
    }

    return {
      verificationAttemptId: String(issuedContext.attempt.id),
      contactType: input.body.contactType,
      contactMethodId: issuedContext.contactMethodId,
      // Refleja lo que realmente pasó con el proveedor, no un optimismo fijo.
      deliveryStatus: delivery.delivered ? 'sent' : 'delivery_failed',
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    };
  }

  async submitContactVerification(input: FlowInput & { body: ContactVerificationSubmitDto }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const customer = await this.customersRepository.findById(input.tenantId, input.customerId, { transaction });
      if (!customer) throw new NotFoundException('Cliente no encontrado.');

      const contactMethod = await this.contactResolution.resolve({
        tenantId: input.tenantId,
        customerId: input.customerId,
        contactType: input.body.contactType,
        contactMethodId: input.body.contactMethodId,
        transaction,
      });
      if (contactMethod.status === 'verified') throw new ConflictException('CONTACT_ALREADY_VERIFIED');

      const attempt = await this.onboardingRepository.findLatestContactVerificationAttempt(input.tenantId, String(contactMethod.id), {
        transaction,
      });
      if (!attempt) throw new NotFoundException('VERIFICATION_ATTEMPT_NOT_FOUND');

      const context = this.contextOf(input, now, transaction, input.body.contactType);

      // La vigencia y los intentos los gobierna el código emitido (`auth_one_time_codes`), no la
      // marca de tiempo del intento: el intento es la bitácora, el código es la verdad.
      const verification = await this.codeService.verify({
        customerId: input.customerId,
        contactType: input.body.contactType,
        candidate: input.body.verificationCode,
      });

      if (!verification.ok) {
        await this.onboardingRepository.updateContactVerificationAttempt(
          attempt,
          {
            verificationStatus: verification.reason === 'invalid' ? 'failed' : 'expired',
            verifiedAt: null,
            failureReasonCode: verification.reason === 'invalid' ? 'invalid_code' : verification.reason,
            confidenceScore: verification.reason === 'invalid' ? '0.00' : null,
          },
          { transaction },
        );
        await this.journal.recordFailure(context, {
          failureReasonCode: verification.reason === 'invalid' ? 'invalid_code' : verification.reason,
        });
        if (verification.reason === 'expired') throw new UnauthorizedException('VERIFICATION_CODE_EXPIRED');
        if (verification.reason === 'not_found') throw new NotFoundException('VERIFICATION_ATTEMPT_NOT_FOUND');
        throw new UnauthorizedException('INVALID_VERIFICATION_CODE');
      }

      await this.onboardingRepository.updateContactVerificationAttempt(
        attempt,
        { verificationStatus: 'verified', verifiedAt: now, failureReasonCode: null, confidenceScore: '1.00' },
        { transaction },
      );
      await this.onboardingRepository.markContactMethodVerified(contactMethod, now, { transaction });

      // Cierre de la corrección: el contacto que el cliente acaba de probar que controla pasa a ser
      // el principal. Sin esto, verificar el teléfono corregido no servía de nada — todo lo que mira
      // "el contacto del cliente" seguía apuntando al que había escrito mal.
      const promotion = await this.contactResolution.promoteToPrimary({
        tenantId: input.tenantId,
        customer,
        contactMethod,
        now,
        transaction,
      });

      // Verificar el contacto es lo que abre el resto del onboarding: es el evento que mueve al
      // cliente de `registered` a `onboarding_in_progress`. Antes, verificar no cambiaba nada.
      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'contact_verified',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: `Contacto ${input.body.contactType} verificado.`,
        transaction,
      });

      await this.journal.recordVerified(context, { attemptId: String(attempt.id) });

      // `nextStep` sale del MISMO evaluador que decide la habilitación, no de un literal por
      // servicio. Los valores fijos que devolvía cada paquete contradecían la promesa de un único
      // cálculo server-side y mandaban al cliente a una pantalla que ya había completado.
      const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);

      return {
        customerId: input.customerId,
        contactType: input.body.contactType,
        contactMethodId: String(contactMethod.id),
        verificationStatus: 'verified',
        primaryContactUpdated: promotion.promoted,
        nextStep: assessment.nextStep,
      };
    });
  }

  private contextOf(input: FlowInput & { body: { sessionId?: string } }, now: Date, transaction: Transaction, contactType: string) {
    return {
      tenantId: input.tenantId,
      customerId: input.customerId,
      contactType,
      sessionId: input.body.sessionId ?? null,
      ipAddress: input.ipAddress,
      actorRole: input.currentUser.role,
      actorInternalUserId: input.currentUser.internalUserId ?? null,
      idempotencyKey: input.idempotencyKey,
      now,
      transaction,
    };
  }
}
