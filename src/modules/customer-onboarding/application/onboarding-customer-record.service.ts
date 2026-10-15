/**
 * @file Servicio de aplicación: escribe el cliente, sus credenciales, su perfil inicial, sus contactos y su primer evento de estado.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { createStableCode, lastCharacters } from '../../../common/utils/crypto/hash.util.js';
import { encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { AuthCredentialRepository } from '../../auth/auth-credential.repository.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerContactsRepository } from '../../customers/repositories/customer-contacts.repository.js';
import { INITIAL_CUSTOMER_LIFECYCLE_STATUS } from '../../customers/customer-lifecycle.constants.js';
import { emailDomain, normalizeFullName } from './customer-onboarding-start.helpers.js';
import type { RegistrationCommand } from './ports/onboarding-registration.port.js';

type RegistrationInput = RegistrationCommand['registration'];

/** Escrituras de la identidad base del alta; todas dentro de la transacción que abre el puente. */
@Injectable()
export class OnboardingCustomerRecordService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly authCredentials: AuthCredentialRepository,
  ) {}

  // 1 + 1b. Create customer, then credenciales de autenticación si se envió contraseña.
  async createCustomerAndCredentials(input: {
    tenantId: string;
    input: RegistrationInput;
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
    const credential = await this.authCredentials.createCredentials(
      { tenantId: input.tenantId, actorType: 'customer', actorId: String(customer.id), passwordHash: input.passwordHash },
      { transaction: input.transaction },
    );

    return { customer, credential };
  }

  // 2. Create initial profile version
  async createProfile(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: RegistrationInput;
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
  async createContactMethods(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: RegistrationInput;
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
  async createInitialStatusEvent(input: {
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
}
