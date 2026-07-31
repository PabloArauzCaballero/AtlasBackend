/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { hashSensitiveText, lastCharacters } from '../../../common/utils/crypto/hash.util.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { MAXIMUM_REFERENCE_CONTACTS } from '../../customers/customer-eligibility.constants.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { ReferenceContactsDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';

/**
 * Referencias personales y comerciales (N4).
 *
 * `customer_reference_contacts` existía migrada y sin uso alguno. Su diseño ya contemplaba el punto
 * delicado de este dominio: los datos son de un TERCERO que no consintió el tratamiento. Por eso
 * `consent_basis` es obligatorio en el contrato de entrada, y el nombre y el teléfono se guardan
 * hasheados y cifrados con sobre, igual que la PII del propio cliente — nunca en claro.
 */
@Injectable()
export class CustomerReferenceContactsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listReferences(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const references = await this.profileDataRepository.findReferenceContacts(input.tenantId, input.customerId);
    return {
      customerId: input.customerId,
      references: references.map((reference) => ({
        referenceId: String(reference.id),
        relationshipType: reference.relationshipType,
        phoneLast4: reference.phoneLast4,
        consentBasis: reference.consentBasis,
        contactabilityStatus: reference.contactabilityStatus,
        verificationStatus: reference.verificationStatus,
      })),
    };
  }

  async addReferences(input: {
    tenantId: string;
    customerId: string;
    body: ReferenceContactsDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.profileDataRepository.findReferenceContacts(input.tenantId, input.customerId, { transaction });
      if (existing.length + input.body.references.length > MAXIMUM_REFERENCE_CONTACTS) {
        throw new UnprocessableEntityException(`REFERENCE_LIMIT_EXCEEDED: max=${MAXIMUM_REFERENCE_CONTACTS}`);
      }

      const created: string[] = [];
      for (const reference of input.body.references) {
        const phoneHash = hashSensitiveText(reference.phone);

        // El propio teléfono del cliente no puede ser su referencia, y una referencia no se
        // duplica: ambas cosas inflarían artificialmente la señal de contactabilidad.
        if (phoneHash === customer.primaryPhoneHash) {
          throw new UnprocessableEntityException('REFERENCE_CANNOT_BE_THE_CUSTOMER');
        }
        const duplicate = await this.profileDataRepository.findReferenceByPhoneHash(input.tenantId, input.customerId, phoneHash, {
          transaction,
        });
        if (duplicate) throw new ConflictException('REFERENCE_ALREADY_REGISTERED');

        const row = await this.profileDataRepository.createReferenceContact(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            relationshipType: reference.relationshipType,
            fullNameHash: hashSensitiveText(reference.fullName),
            fullNameEncrypted: await encryptSecretEnvelope(reference.fullName),
            phoneHash,
            phoneEncrypted: await encryptSecretEnvelope(reference.phone),
            phoneLast4: lastCharacters(reference.phone, 4),
            consentBasis: reference.consentBasis,
            createdAt: now,
          },
          { transaction },
        );
        created.push(String(row.id));
      }

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'reference_contacts_added',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { referenceCount: created.length },
        },
        { transaction },
      );

      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'reference_contacts_added',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Referencias personales registradas por el cliente.',
        transaction,
      });

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.reference_contacts_added',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { referenceIds: created },
          occurredAt: now,
        },
        { transaction },
      );

      return { customerId: input.customerId, referenceIds: created, totalReferences: existing.length + created.length };
    });
  }

  async removeReference(input: {
    tenantId: string;
    customerId: string;
    referenceId: string;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const references = await this.profileDataRepository.findReferenceContacts(input.tenantId, input.customerId, { transaction });
      const target = references.find((reference) => String(reference.id) === input.referenceId);
      if (!target) throw new NotFoundException('REFERENCE_NOT_FOUND');

      // Borrado lógico: la referencia declarada en su momento sigue siendo evidencia de lo que el
      // cliente afirmó, aunque después la retire.
      await this.profileDataRepository.softDeleteReference(target, now, { transaction });

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.reference_contact_removed',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { referenceId: input.referenceId },
          occurredAt: now,
        },
        { transaction },
      );

      return { customerId: input.customerId, referenceId: input.referenceId, removed: true };
    });
  }
}
