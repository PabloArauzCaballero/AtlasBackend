import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  createStableCode,
  hashSensitiveText,
  lastCharacters,
  normalizeSensitiveText,
  sha256Hex,
} from '../../../common/utils/crypto/hash.util.js';
import { encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { hashPassword } from '../../../common/utils/crypto/password.util.js';
import { AuthRepository } from '../../auth/auth.repository.js';
import { ConsentsRepository } from '../../consents/consents.repository.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { SessionsRepository } from '../../sessions/sessions.repository.js';
import { StartOnboardingResponseDto } from '../customer-onboarding.dtos.js';
import { toStartOnboardingResponse } from '../customer-onboarding.mapper.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { StartOnboardingDto } from '../customer-onboarding.schemas.js';

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
export class CustomerOnboardingStartService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly consentsRepository: ConsentsRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly authRepository: AuthRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Punto de entrada transaccional de onboarding.
   *
   * Cada paso privado encapsula una escritura o validación del flujo, manteniendo una única
   * transacción para cliente, credenciales, perfil, dispositivo, sesión, permisos y consentimientos.
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

    // La garantía de integridad real la dan los índices únicos parciales de la base de datos.
    // Este try/catch traduce colisiones concurrentes al mismo error de
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

        return toStartOnboardingResponse({ customer, session, device, onboardingFlow });
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

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

    // Credenciales de autenticación opcionales para clientes registrados por onboarding.
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
      // ATLAS-P10-010: envelope encryption (data key propia por valor, en vez de la clave
      // maestra única de secret-box.util.ts) — ver ATLAS-PEND-106/112.
      const phoneEncrypted = input.input.customer.phone ? await encryptSecretEnvelope(input.input.customer.phone) : null;
      await this.customersRepository.createContactMethod(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          contactType: 'phone',
          contactValueHash: input.phoneHash,
          contactValueEncrypted: phoneEncrypted,
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
      const emailEncrypted = input.input.customer.email ? await encryptSecretEnvelope(input.input.customer.email) : null;
      await this.customersRepository.createContactMethod(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          contactType: 'email',
          contactValueHash: input.emailHash,
          contactValueEncrypted: emailEncrypted,
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
}
