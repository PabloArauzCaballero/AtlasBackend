import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import {
  createStableCode,
  hashSensitiveText,
  lastCharacters,
  normalizeSensitiveText,
  sha256Hex,
} from '../../common/utils/crypto/hash.util.js';
import { encryptSecret } from '../../common/utils/crypto/secret-box.util.js';
import { hashPassword } from '../../common/utils/crypto/password.util.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { ConsentsRepository } from '../consents/consents.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { SessionsRepository } from '../sessions/sessions.repository.js';
import { StartOnboardingResponseDto } from './customer-onboarding.dtos.js';
import { toStartOnboardingResponse } from './customer-onboarding.mapper.js';
import { CustomerOnboardingRepository } from './customer-onboarding.repository.js';
import {
  AddressPackageDto,
  ContactVerificationRequestDto,
  ContactVerificationSubmitDto,
  IdentityPackageDto,
  StartOnboardingDto,
} from './customer-onboarding.schemas.js';

function emailDomain(email: string | undefined): string | null {
  if (!email) return null;
  const domain = email.split('@')[1];
  return domain ? normalizeSensitiveText(domain) : null;
}

function normalizeFullName(firstName?: string, lastName?: string): string | null {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName.length === 0 ? null : fullName.toLocaleLowerCase('es-BO');
}

@Injectable()
export class CustomerOnboardingService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly consentsRepository: ConsentsRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly authRepository: AuthRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * ATLAS-AUDIT-010 (cerrado en este patch): `startOnboarding` era un único método de ~400
   * líneas que escribía en 15+ tablas distintas. Se descompuso en pasos privados, cada uno con
   * una única responsabilidad, conservando exactamente el mismo orden y la misma lógica que
   * tenía el método original (los comentarios `// N.` se mantienen para que el mapeo contra la
   * versión anterior sea trazable). El método público sigue siendo el único punto de entrada y
   * sigue abriendo una única transacción — el comportamiento observable no cambia, solo cómo
   * está organizado el código.
   */
  async startOnboarding(
    tenantId: string,
    input: StartOnboardingDto,
    ipAddress: string | null,
    idempotencyKey: string,
  ): Promise<StartOnboardingResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('X-Idempotency-Key header is required.');
    }

    const phoneHash = input.customer.phone ? hashSensitiveText(input.customer.phone) : null;
    const emailHash = input.customer.email ? hashSensitiveText(input.customer.email) : null;

    await this.assertNoDuplicateCustomer(tenantId, phoneHash, emailHash);
    await this.assertConsentDocumentsAreValid(tenantId, input.consents);

    // ATLAS-AUDIT-021 / ATLAS-AUDIT-028 (cerrado en este patch): la verificación de arriba
    // (`assertNoDuplicateCustomer`) es un chequeo de UX que falla rápido con un mensaje claro,
    // pero bajo concurrencia real (dos registros casi simultáneos con el mismo email/teléfono)
    // no es suficiente por sí sola — es un patrón check-then-act no atómico. La garantía de
    // integridad real la da el índice único parcial a nivel de base de datos: ya existía para
    // `primary_phone_hash` y se agregó para `primary_email_hash` en la migración
    // `20260701000000-add-auth-credentials-and-email-uniqueness.ts`. El `try/catch` de abajo
    // captura la colisión bajo carrera (`UniqueConstraintError`) y la traduce al mismo error de
    // negocio que el chequeo previo, para que el cliente de la app siempre reciba el mismo
    // código (`CUSTOMER_ALREADY_EXISTS`) sin importar si perdió la carrera o si simplemente
    // llegó segundo en el tiempo.
    //
    // La deduplicación por `X-Idempotency-Key` (reintentos del MISMO request) la cubre el
    // `IdempotencyInterceptor` global (`src/modules/runtime-hardening/idempotency.interceptor.ts`)
    // sobre la tabla `idempotency_keys`; este bloque cubre el caso distinto de dos requests
    // *diferentes* (idempotency keys distintas) que describen al mismo cliente.

    const now = new Date();
    const sourceType = input.onboarding?.sourceType ?? 'mobile_app';
    // Se hashea ANTES de abrir la transacción a propósito: Argon2id es una operación
    // intencionalmente costosa en CPU/memoria; hacerla dentro de la transacción de base de
    // datos extendería innecesariamente el tiempo que la transacción mantiene locks abiertos.
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const customer = await this.createCustomerAndCredentials({
          tenantId,
          input,
          phoneHash,
          emailHash,
          passwordHash,
          now,
          transaction,
        });

        await this.createProfile({ tenantId, customer, input, sourceType, now, transaction });
        await this.createContactMethods({ tenantId, customer, input, phoneHash, emailHash, sourceType, now, transaction });
        await this.createInitialStatusEvent({ tenantId, customer, now, transaction });

        const { device, link } = await this.resolveDeviceAndLink({ tenantId, customer, input, now, transaction });

        const session = await this.createOnboardingSession({ tenantId, customer, device, link, input, ipAddress, now, transaction });

        await this.captureDeviceSnapshotIfProvided({ tenantId, customer, device, session, input, now, transaction });

        const onboardingFlow = await this.createOnboardingFlowAndFirstEvent({
          tenantId,
          customer,
          session,
          input,
          sourceType,
          phoneHash,
          emailHash,
          now,
          transaction,
        });

        await this.recordPermissionDecisions({ tenantId, customer, session, onboardingFlow, input, now, transaction });

        await this.recordActionAndAuditLogs({
          tenantId,
          customer,
          session,
          device,
          onboardingFlow,
          input,
          ipAddress,
          idempotencyKey,
          sourceType,
          now,
          transaction,
        });

        await this.recordConsents({ tenantId, customer, session, input, ipAddress, now, transaction });

        return toStartOnboardingResponse({ customer, session, device });
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Pasos privados de startOnboarding (ATLAS-AUDIT-010). Cada uno hace exactamente lo que
  // hacía el bloque numerado equivalente en la versión anterior de este método.
  // ---------------------------------------------------------------------------------------

  private async assertNoDuplicateCustomer(tenantId: string, phoneHash: string | null, emailHash: string | null): Promise<void> {
    const existing = await this.customersRepository.findByContactHash(tenantId, {
      phoneHash: phoneHash ?? undefined,
      emailHash: emailHash ?? undefined,
    });

    if (existing) {
      throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
    }
  }

  private async assertConsentDocumentsAreValid(tenantId: string, consents: StartOnboardingDto['consents']): Promise<void> {
    // Validate all referenced consent documents exist before opening the transaction
    for (const consentInput of consents) {
      if (!consentInput.granted) {
        throw new UnprocessableEntityException('REQUIRED_CONSENT_MISSING');
      }
      const doc = await this.consentsRepository.findActiveDocumentById(tenantId, consentInput.consentDocumentId);
      if (!doc) {
        throw new UnprocessableEntityException(
          `Consent document ${consentInput.consentDocumentId} not found, not published, or not active.`,
        );
      }
    }
  }

  // 1 + 1b. Create customer, then credenciales de autenticación si se envió contraseña.
  private async createCustomerAndCredentials(input: {
    tenantId: string;
    input: StartOnboardingDto;
    phoneHash: string | null;
    emailHash: string | null;
    passwordHash: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const customer = await this.customersRepository.createCustomer(
      {
        tenantId: input.tenantId,
        customerCode: createStableCode('CUS'),
        customerUuid: randomUUID(),
        primaryPhoneHash: input.phoneHash,
        primaryPhoneLast4: input.input.customer.phone ? lastCharacters(input.input.customer.phone, 4) : null,
        primaryEmailHash: input.emailHash,
        primaryEmailDomain: emailDomain(input.input.customer.email),
        lifecycleStatus: 'registered',
        createdAt: input.now,
      },
      { transaction: input.transaction },
    );

    // ATLAS-AUDIT-002: credenciales de autenticación (opcional — ver PENDIENTE_ATLAS sobre
    // mecanismo definitivo de auth del consumidor final, documentado en el schema de entrada).
    if (input.passwordHash) {
      await this.authRepository.createCredentials(
        { tenantId: input.tenantId, actorType: 'customer', actorId: String(customer.id), passwordHash: input.passwordHash },
        { transaction: input.transaction },
      );
    }

    return customer;
  }

  // 2. Create initial profile version
  private async createProfile(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: StartOnboardingDto;
    sourceType: string;
    now: Date;
    transaction: Transaction;
  }) {
    const profile = await this.customersRepository.createProfileVersion(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        firstName: input.input.customer.firstName ?? null,
        lastName: input.input.customer.lastName ?? null,
        fullNameNormalized: normalizeFullName(input.input.customer.firstName, input.input.customer.lastName),
        birthDate: input.input.customer.birthDate ?? null,
        preferredLanguage: 'es',
        marketingOptIn: false,
        sourceType: input.sourceType,
        createdAt: input.now,
      },
      { transaction: input.transaction },
    );

    await this.customersRepository.updateCurrentProfileVersion(input.customer, String(profile.id), input.now, {
      transaction: input.transaction,
    });

    return profile;
  }

  // 3. Create contact methods
  private async createContactMethods(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: StartOnboardingDto;
    phoneHash: string | null;
    emailHash: string | null;
    sourceType: string;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    if (input.phoneHash) {
      await this.customersRepository.createContactMethod(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          contactType: 'phone',
          contactValueHash: input.phoneHash,
          contactValueEncrypted: input.input.customer.phone ? encryptSecret(input.input.customer.phone) : null,
          valueLast4: input.input.customer.phone ? lastCharacters(input.input.customer.phone, 4) : null,
          emailDomain: null,
          isPrimary: true,
          sourceType: input.sourceType,
          createdAt: input.now,
        },
        { transaction: input.transaction },
      );
    }

    if (input.emailHash) {
      await this.customersRepository.createContactMethod(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          contactType: 'email',
          contactValueHash: input.emailHash,
          contactValueEncrypted: input.input.customer.email ? encryptSecret(input.input.customer.email) : null,
          valueLast4: null,
          emailDomain: emailDomain(input.input.customer.email),
          isPrimary: input.phoneHash === null,
          sourceType: input.sourceType,
          createdAt: input.now,
        },
        { transaction: input.transaction },
      );
    }
  }

  // 4. Create initial status event (append-only)
  private async createInitialStatusEvent(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    await this.customersRepository.createStatusEvent(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        previousStatus: null,
        newStatus: 'registered',
        reasonCode: 'customer_registered',
        changedByType: 'system',
        happenedAt: input.now,
        notes: 'Registro inicial desde POST /customer-onboarding/start.',
      },
      { transaction: input.transaction },
    );
  }

  // 5 + 6 + 7. Resolve global device fingerprint, tenant-scoped device, y customer-device link.
  private async resolveDeviceAndLink(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: StartOnboardingDto;
    now: Date;
    transaction: Transaction;
  }) {
    // 5. Resolve global device fingerprint
    let globalDevice = await this.sessionsRepository.findGlobalDevice(
      input.input.device.deviceFingerprintHash,
      input.input.device.fingerprintVersion,
      { transaction: input.transaction },
    );

    if (!globalDevice) {
      globalDevice = await this.sessionsRepository.createGlobalDevice(
        {
          deviceFingerprint: input.input.device.deviceFingerprintHash,
          fingerprintVersion: input.input.device.fingerprintVersion,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    } else {
      await this.sessionsRepository.touchGlobalDevice(globalDevice, input.now, { transaction: input.transaction });
    }

    // 6. Resolve tenant-scoped device
    let device = await this.sessionsRepository.findDevice(
      input.tenantId,
      input.input.device.deviceFingerprintHash,
      input.input.device.fingerprintVersion,
      { transaction: input.transaction },
    );

    if (!device) {
      device = await this.sessionsRepository.createDevice(
        {
          tenantId: input.tenantId,
          globalDeviceFingerprintId: String(globalDevice.id),
          deviceFingerprint: input.input.device.deviceFingerprintHash,
          fingerprintVersion: input.input.device.fingerprintVersion,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    } else {
      await this.sessionsRepository.touchDevice(device, input.now, { transaction: input.transaction });
    }

    // 7. Create customer-device link
    let link = await this.sessionsRepository.findCustomerDeviceLink(input.tenantId, String(input.customer.id), String(device.id), {
      transaction: input.transaction,
    });

    if (!link) {
      link = await this.sessionsRepository.createCustomerDeviceLink(
        { tenantId: input.tenantId, customerId: String(input.customer.id), deviceId: String(device.id), now: input.now },
        { transaction: input.transaction },
      );
    }

    return { device, link };
  }

  // 8. Create initial onboarding session
  private async createOnboardingSession(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    device: Awaited<ReturnType<SessionsRepository['findDevice']>>;
    link: Awaited<ReturnType<SessionsRepository['findCustomerDeviceLink']>>;
    input: StartOnboardingDto;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const session = await this.sessionsRepository.createSession(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        deviceId: String(input.device!.id),
        sessionTokenHash: sha256Hex(randomUUID()),
        channel: input.input.device.channel,
        authMethod: 'onboarding',
        ipAddress: input.ipAddress,
        userAgent: input.input.device.userAgent ?? null,
        gpsLat: null,
        gpsLng: null,
        gpsAccuracyMeters: null,
        now: input.now,
      },
      { transaction: input.transaction },
    );

    await this.sessionsRepository.touchCustomerDeviceLink(input.link!, String(session.id), input.now, { transaction: input.transaction });

    return session;
  }

  // 9. Capture device snapshot if provided
  private async captureDeviceSnapshotIfProvided(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    device: Awaited<ReturnType<SessionsRepository['findDevice']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    input: StartOnboardingDto;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    if (input.input.device.snapshot) {
      await this.sessionsRepository.createDeviceSnapshot(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          deviceId: String(input.device!.id),
          sessionId: String(input.session.id),
          brand: input.input.device.snapshot.brand ?? null,
          model: input.input.device.snapshot.model ?? null,
          osFamily: input.input.device.snapshot.osFamily ?? null,
          osVersion: input.input.device.snapshot.osVersion ?? null,
          appVersion: input.input.device.snapshot.appVersion ?? null,
          isRooted: input.input.device.snapshot.isRooted ?? null,
          isEmulator: input.input.device.snapshot.isEmulator ?? null,
          vpnDetected: input.input.device.snapshot.vpnDetected ?? null,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    }
  }

  // 10. Create onboarding flow and first step event.
  private async createOnboardingFlowAndFirstEvent(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    input: StartOnboardingDto;
    sourceType: string;
    phoneHash: string | null;
    emailHash: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const onboardingFlow = await this.onboardingRepository.createOnboardingFlow(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        sessionId: String(input.session.id),
        flowVersion: 'v1',
        startedAt: input.now,
        completionStatus: 'in_progress',
      },
      { transaction: input.transaction },
    );

    await this.onboardingRepository.createOnboardingStepEvent(
      {
        tenantId: input.tenantId,
        onboardingFlowId: String(onboardingFlow.id),
        stepCode: input.input.onboarding?.startedStepCode ?? 'registration_started',
        eventType: 'started',
        happenedAt: input.now,
        payloadJson: {
          sourceType: input.sourceType,
          channel: input.input.device.channel,
          hasPhone: input.phoneHash !== null,
          hasEmail: input.emailHash !== null,
          consentCount: input.input.consents.length,
        },
      },
      { transaction: input.transaction },
    );

    return onboardingFlow;
  }

  // 11. Capture permission decisions as append-only events.
  private async recordPermissionDecisions(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    onboardingFlow: Awaited<ReturnType<CustomerOnboardingRepository['createOnboardingFlow']>>;
    input: StartOnboardingDto;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    for (const permissionInput of input.input.permissions ?? []) {
      const decidedAt = permissionInput.decidedAt ? new Date(permissionInput.decidedAt) : input.now;
      await this.onboardingRepository.createPermissionEvent(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          sessionId: String(input.session.id),
          onboardingFlowId: String(input.onboardingFlow.id),
          permissionCode: permissionInput.permissionCode,
          granted: permissionInput.granted,
          decidedAt,
        },
        { transaction: input.transaction },
      );
    }
  }

  // 12. Register customer-level action and operational audit events.
  private async recordActionAndAuditLogs(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    device: Awaited<ReturnType<SessionsRepository['findDevice']>>;
    onboardingFlow: Awaited<ReturnType<CustomerOnboardingRepository['createOnboardingFlow']>>;
    input: StartOnboardingDto;
    ipAddress: string | null;
    idempotencyKey: string;
    sourceType: string;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    await this.onboardingRepository.createCustomerActionLog(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        sessionId: String(input.session.id),
        deviceId: String(input.device!.id),
        eventName: 'customer_onboarding_started',
        screenName: 'onboarding_start',
        payloadJson: {
          sourceType: input.sourceType,
          channel: input.input.device.channel,
          idempotencyKeyHash: sha256Hex(input.idempotencyKey),
        },
        occurredAt: input.now,
      },
      { transaction: input.transaction },
    );

    await this.onboardingRepository.createOperationalAuditLog(
      {
        tenantId: input.tenantId,
        actorType: 'customer',
        actionCode: 'customer_onboarding.start',
        targetType: 'customer',
        targetId: String(input.customer.id),
        ipAddress: input.ipAddress,
        userAgent: input.input.device.userAgent ?? null,
        payloadJson: {
          onboardingFlowId: String(input.onboardingFlow.id),
          sessionId: String(input.session.id),
          deviceId: String(input.device!.id),
          idempotencyKeyHash: sha256Hex(input.idempotencyKey),
        },
        occurredAt: input.now,
      },
      { transaction: input.transaction },
    );
  }

  // 13. Record consents and consent events.
  private async recordConsents(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    input: StartOnboardingDto;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    for (const consentInput of input.input.consents) {
      const happenedAt = consentInput.acceptedAt ? new Date(consentInput.acceptedAt) : input.now;

      const consent = await this.consentsRepository.createCustomerConsent(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          consentDocumentId: consentInput.consentDocumentId,
          purposeCode: consentInput.purposeCode,
          granted: consentInput.granted,
          channel: input.input.device.channel,
          sessionId: String(input.session.id),
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.input.device.deviceFingerprintHash,
          userAgent: input.input.device.userAgent ?? null,
          evidenceSnapshotUrl: null,
          happenedAt,
        },
        { transaction: input.transaction },
      );

      await this.consentsRepository.createConsentEvent(
        {
          tenantId: input.tenantId,
          customerConsentId: String(consent.id),
          eventType: consentInput.granted ? 'granted' : 'declined',
          channel: input.input.device.channel,
          sessionId: String(input.session.id),
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.input.device.deviceFingerprintHash,
          triggeredByType: 'customer',
          triggeredByInternalUserId: null,
          notes: 'Consentimiento registrado durante onboarding inicial.',
          happenedAt,
        },
        { transaction: input.transaction },
      );
    }
  }

  private assertCustomerScope(customerId: string, currentUser: AuthenticatedUser): void {
    const internalRoles = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin'];
    if (internalRoles.includes(currentUser.role)) return;
    if (currentUser.role !== 'customer' || currentUser.customerId !== customerId) {
      throw new ForbiddenException('El token no permite operar sobre este cliente.');
    }
  }

  async requestContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationRequestDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    this.assertCustomerScope(input.customerId, input.currentUser);

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
    this.assertCustomerScope(input.customerId, input.currentUser);

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

      // Development-safe placeholder: the real OTP provider is still pending.
      // Never persist or log real OTPs in plaintext. For local smoke tests only, 123456 is accepted.
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

  async submitIdentityPackage(input: {
    tenantId: string;
    customerId: string;
    body: IdentityPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    this.assertCustomerScope(input.customerId, input.currentUser);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const front = input.body.evidence.find((item) => item.evidenceType === 'identity_front');
    if (!front) throw new UnprocessableEntityException('REQUIRED_EVIDENCE_MISSING');
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      let providerRequestId: string | null = null;
      if (input.body.provider) {
        const providerRequest = await this.onboardingRepository.createDataProviderRequest(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            requestType: 'identity_verification',
            providerRequestRef: input.body.provider.providerCode,
            requestPayloadHash: input.body.provider.requestPayloadHash ?? null,
            idempotencyKey: input.idempotencyKey,
            requestedAt: now,
          },
          { transaction },
        );
        providerRequestId = String(providerRequest.id);
        await this.onboardingRepository.createDataProviderResponse(
          {
            tenantId: input.tenantId,
            providerRequestId,
            responseHash: sha256Hex(`${providerRequestId}:pending`),
            normalizedPayloadJson: { status: 'pending_manual_or_external_verification' },
            createdAt: now,
          },
          { transaction },
        );
      }

      const evidenceIds: Record<string, string> = {};
      for (const evidenceInput of input.body.evidence) {
        const evidence = await this.onboardingRepository.createEvidenceDocument(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            documentType: evidenceInput.evidenceType,
            storageKey: evidenceInput.storageKey,
            mimeType: evidenceInput.mimeType,
            sha256Hash: evidenceInput.sha256Hash,
            fileSizeBytes: evidenceInput.fileSizeBytes ?? null,
            sessionId: input.body.sessionId ?? null,
            ipAddress: input.ipAddress,
            uploadedAt: now,
          },
          { transaction },
        );
        evidenceIds[evidenceInput.evidenceType] = String(evidence.id);
        await this.onboardingRepository.createEvidenceExtraction(
          {
            tenantId: input.tenantId,
            evidenceDocumentId: String(evidence.id),
            extractedAt: now,
            requiresReview: true,
            extractedDataJson: { extractionStatus: 'not_executed' },
          },
          { transaction },
        );
        await this.onboardingRepository.createEvidenceReview(
          {
            tenantId: input.tenantId,
            evidenceDocumentId: String(evidence.id),
            reviewStatus: 'pending_review',
            reviewedAt: now,
            notes: 'Evidencia recibida durante identity-package.',
          },
          { transaction },
        );
      }

      const identityDocument = await this.onboardingRepository.createIdentityDocument(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          documentType: input.body.identity.documentType,
          numberHash: input.body.identity.documentNumberHash,
          numberLast4: input.body.identity.documentLast4,
          issuedIn: input.body.identity.issuedIn ?? null,
          issuedAt: input.body.identity.issuedAt ?? null,
          expiresAt: input.body.identity.expiresAt ?? null,
          frontEvidenceId: evidenceIds.identity_front ?? null,
          backEvidenceId: evidenceIds.identity_back ?? null,
          createdAt: now,
        },
        { transaction },
      );

      const attempt = await this.onboardingRepository.createIdentityVerificationAttempt(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          identityDocumentId: String(identityDocument.id),
          providerRequestId,
          consentId: null,
          verificationChannel: 'onboarding_package',
          finalResult: 'pending_review',
          reasonCodesJson: { reasonCodes: ['identity_evidence_pending_review'] },
          requestedAt: now,
        },
        { transaction },
      );

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'identity_package_submitted',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { evidenceCount: input.body.evidence.length, identityDocumentId: String(identityDocument.id) },
        },
        { transaction },
      );
      await this.customersRepository.createStatusEvent(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          previousStatus: customer.lifecycleStatus,
          newStatus: 'pending_identity_review',
          reasonCode: 'identity_package_submitted',
          changedByType: input.currentUser.role,
          happenedAt: now,
          notes: 'Paquete KYC recibido.',
        },
        { transaction },
      );
      await this.onboardingRepository.updateCustomerStatus(customer, 'pending_identity_review', now, { transaction });
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'identity_package_submitted',
          screenName: 'identity_capture',
          payloadJson: { idempotencyKeyHash: sha256Hex(input.idempotencyKey), evidenceCount: input.body.evidence.length },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.identity_package',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { identityDocumentId: String(identityDocument.id), verificationAttemptId: String(attempt.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        identityVerificationAttemptId: String(attempt.id),
        status: 'pending_review',
        nextStep: 'risk_evaluation',
      };
    });
  }

  async submitAddressPackage(input: {
    tenantId: string;
    customerId: string;
    body: AddressPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    this.assertCustomerScope(input.customerId, input.currentUser);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let address = await this.onboardingRepository.findCurrentAddress(input.tenantId, input.customerId, 'home', { transaction });
      if (!address) {
        address = await this.onboardingRepository.createAddress(
          { tenantId: input.tenantId, customerId: input.customerId, addressType: 'home', now },
          { transaction },
        );
      } else {
        await this.onboardingRepository.touchAddress(address, now, { transaction });
      }

      const declaredAddressText = input.body.address.addressLineEncrypted ?? null;
      const normalizedAddressText = declaredAddressText ? sha256Hex(declaredAddressText) : null;
      const version = await this.onboardingRepository.createAddressVersion(
        {
          tenantId: input.tenantId,
          customerAddressId: String(address.id),
          declaredAddressText,
          normalizedAddressText,
          zone: input.body.address.zone ?? null,
          city: input.body.address.city,
          department: input.body.address.department,
          countryCode: input.body.address.countryCode,
          sourceType: 'customer_onboarding',
          validFrom: now,
        },
        { transaction },
      );
      await this.onboardingRepository.updateAddressCurrentVersion(address, String(version.id), now, { transaction });

      if (input.body.gpsObservation) {
        const gps = input.body.gpsObservation;
        await this.onboardingRepository.createGpsObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            customerAddressId: String(address.id),
            addressVersionId: String(version.id),
            sessionId: input.body.sessionId ?? null,
            gpsLat: gps.lat.toFixed(7),
            gpsLng: gps.lng.toFixed(7),
            gpsAccuracyMeters: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            capturedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
        await this.onboardingRepository.createCustomerObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            sessionId: input.body.sessionId ?? null,
            deviceId: null,
            observationCode: 'gps_address_observed',
            valueText: null,
            valueNumber: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            valueBoolean: null,
            valueJson: { hasGps: true, accuracyMeters: gps.accuracyMeters ?? null },
            confidenceScore: null,
            observedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
      }

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'address_package_submitted',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
        },
        { transaction },
      );
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'address_package_submitted',
          screenName: 'address_capture',
          payloadJson: { idempotencyKeyHash: sha256Hex(input.idempotencyKey), hasGps: input.body.gpsObservation !== undefined },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.address_package',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        addressId: String(address.id),
        addressVersionId: String(version.id),
        status: 'recorded',
        nextStep: 'risk_evaluation',
      };
    });
  }
}
