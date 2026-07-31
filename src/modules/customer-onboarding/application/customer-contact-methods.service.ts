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
import { hashSensitiveText, lastCharacters, normalizeSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { AddContactMethodDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';

function emailDomainOf(value: string): string | null {
  const domain = value.split('@')[1];
  return domain ? normalizeSensitiveText(domain) : null;
}

/**
 * Alta de un método de contacto adicional o corrección de uno mal escrito (N6).
 *
 * Cubre un callejón sin salida del flujo anterior: si el cliente se equivocaba al escribir su
 * teléfono en el registro, el OTP nunca llegaba y NO existía ningún endpoint para corregirlo. El
 * único camino era abandonar la cuenta.
 *
 * El contacto nuevo nace `unverified` a propósito: agregarlo no otorga confianza, solo habilita
 * pedir un código sobre él. La verificación sigue siendo el único camino a `verified`.
 */
@Injectable()
export class CustomerContactMethodsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async addContactMethod(input: {
    tenantId: string;
    customerId: string;
    body: AddContactMethodDto;
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

    const contactValueHash = hashSensitiveText(input.body.value);
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.profileDataRepository.findContactMethodByHash(input.tenantId, input.customerId, contactValueHash, {
        transaction,
      });
      if (existing) throw new ConflictException('CONTACT_ALREADY_REGISTERED');

      const isEmail = input.body.contactType === 'email';
      const contact = await this.profileDataRepository.createContactMethod(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          contactType: input.body.contactType,
          contactValueHash,
          contactValueEncrypted: await encryptSecretEnvelope(input.body.value),
          valueLast4: isEmail ? null : lastCharacters(input.body.value, 4),
          emailDomain: isEmail ? emailDomainOf(input.body.value) : null,
          label: input.body.label ?? `secondary_${input.body.contactType}`,
          createdAt: now,
        },
        { transaction },
      );

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.contact_method_added',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          // Nunca el valor en claro: esta tabla es de auditoría y el teléfono/email es PII.
          payloadJson: { contactMethodId: String(contact.id), contactType: input.body.contactType },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        contactMethodId: String(contact.id),
        contactType: contact.contactType,
        status: contact.status,
        valueLast4: contact.valueLast4,
        emailDomain: contact.emailDomain,
        nextStep: 'contact_verification',
      };
    });
  }
}
