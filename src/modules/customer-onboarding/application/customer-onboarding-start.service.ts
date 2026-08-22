/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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
import { AuthTokenIssuerService } from '../../auth/auth-token-issuer.service.js';
import { ConsentsRepository } from '../../consents/consents.repository.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerContactsRepository } from '../../customers/repositories/customer-contacts.repository.js';
import { SessionsRepository } from '../../sessions/sessions.repository.js';
import { StartOnboardingResponseDto } from '../customer-onboarding.dtos.js';
import { toStartOnboardingResponse } from '../customer-onboarding.mapper.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerOnboardingGuardsService } from './customer-onboarding-guards.service.js';
import { OnboardingDeviceSessionService } from './onboarding-device-session.service.js';
import { StartOnboardingDto } from '../customer-onboarding.schemas.js';
import { INITIAL_CUSTOMER_LIFECYCLE_STATUS } from '../../customers/customer-lifecycle.constants.js';

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
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly consentsRepository: ConsentsRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly authRepository: AuthRepository,
    private readonly tokenIssuer: AuthTokenIssuerService,
    private readonly guardsService: CustomerOnboardingGuardsService,
    // Dispositivo, sesión y su instantánea: tres pasos que solo hablan con `SessionsRepository` y
    // que no comparten nada con el resto del alta salvo el cliente recién creado.
    private readonly deviceSession: OnboardingDeviceSessionService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Punto de entrada transaccional de onboarding.
   *
   * Cada paso privado encapsula una escritura o validación del flujo, manteniendo una única
   * transacción para cliente, credenciales, perfil, dispositivo, sesión, permisos y consentimientos.
   *
   * La garantía de integridad real la dan los índices únicos parciales de la base de datos. El
   * `try/catch` de abajo traduce las colisiones concurrentes al mismo error de negocio que el
   * chequeo previo, para que la app siempre reciba el mismo código (`CUSTOMER_ALREADY_EXISTS`) sin
   * importar si perdió la carrera o si simplemente llegó segunda en el tiempo.
   *
   * La deduplicación por `X-Idempotency-Key` (reintentos del MISMO request) la cubre el
   * `IdempotencyInterceptor` global (`src/modules/runtime-hardening/idempotency.interceptor.ts`)
   * sobre la tabla `idempotency_keys`; este bloque cubre el caso distinto de dos requests
   * *diferentes* (claves de idempotencia distintas) que describen al mismo cliente.
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

    await this.guardsService.assertNoDuplicateCustomer(tenantId, phoneHash, emailHash);
    await this.guardsService.assertConsentDocumentsAreValid(tenantId, input.consents);

    const now = new Date();
    const sourceType = input.onboarding?.sourceType ?? 'mobile_app';
    // Se hashea ANTES de abrir la transacción a propósito: Argon2id es una operación
    // intencionalmente costosa en CPU/memoria; hacerla dentro de la transacción de base de
    // datos extendería innecesariamente el tiempo que la transacción mantiene locks abiertos.
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const { customer, credential } = await this.createCustomerAndCredentials({
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

        // Dispositivo, sesión e instantánea van siempre juntos: no existe un alta que resuelva el
        // dispositivo y no abra su sesión.
        const { device, session } = await this.deviceSession.openSessionForNewCustomer({
          tenantId,
          customer,
          input,
          ipAddress,
          now,
          transaction,
        });

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

        // Permisos, bitácora/auditoría y consentimientos: el rastro de lo que el cliente aceptó y
        // de lo que el sistema hizo con ello, escrito en la misma transacción que lo produjo.
        await this.recordDecisionsAndAudit({
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

        // Los tokens se emiten DENTRO de la transacción: si el alta se deshace, el refresh token
        // emitido se deshace con ella. Emitirlos después del commit dejaría una ventana en la que
        // existe una credencial válida para un cliente que la base todavía no confirmó.
        const tokens = await this.tokenIssuer.issueRegistrationTokens({
          tenantId,
          customerId: String(customer.id),
          tokenVersion: credential.tokenVersion,
          ipAddress,
          userAgent: input.device.userAgent ?? null,
          transaction,
        });

        return toStartOnboardingResponse({ customer, session, device, onboardingFlow, tokens });
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  // 1 + 1b. Create customer, then credenciales de autenticación si se envió contraseña.
  private async createCustomerAndCredentials(input: {
    tenantId: string;
    input: StartOnboardingDto;
    phoneHash: string | null;
    emailHash: string | null;
    passwordHash: string;
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
        lifecycleStatus: INITIAL_CUSTOMER_LIFECYCLE_STATUS,
        createdAt: input.now,
      },
      { transaction: input.transaction },
    );

    // Credenciales siempre presentes: sin ellas el cliente no puede iniciar sesión nunca más.
    const credential = await this.authRepository.createCredentials(
      { tenantId: input.tenantId, actorType: 'customer', actorId: String(customer.id), passwordHash: input.passwordHash },
      { transaction: input.transaction },
    );

    return { customer, credential };
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
      await this.customerContactsRepository.createContactMethod(
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
      await this.customerContactsRepository.createContactMethod(
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
        newStatus: INITIAL_CUSTOMER_LIFECYCLE_STATUS,
        reasonCode: 'customer_registered',
        changedByType: 'system',
        happenedAt: input.now,
        notes: 'Registro inicial desde POST /customer-onboarding/start.',
      },
      { transaction: input.transaction },
    );
  }

  // 5 + 6 + 7. Resolve global device fingerprint, tenant-scoped device, y customer-device link.
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
  /**
   * Agrupa el rastro del alta: permisos concedidos, bitácora de acción + auditoría operativa y
   * consentimientos. Van juntos porque los tres describen lo mismo desde ángulos distintos y
   * ninguno tiene sentido sin los otros dos en el expediente.
   */
  private async recordDecisionsAndAudit(input: {
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
    await this.recordPermissionDecisions(input);
    await this.recordActionAndAuditLogs(input);
    await this.recordConsents(input);
  }

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
