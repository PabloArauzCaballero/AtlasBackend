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
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
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
    private readonly eligibilityService: CustomerEligibilityService,
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

    /*
     * Un cliente ACTIVO también cambia de correo y de teléfono.
     *
     * La comprobación solo admitía los estados del alta, así que en cuanto la cuenta quedaba
     * `active` el endpoint respondía `PROFILE_NOT_EDITABLE_IN_STATUS` y no había ningún otro camino:
     * quien cambiaba de número —o se daba de alta con un correo que ya no usa— se quedaba sin forma
     * de recibir el código de verificación, que es justamente por donde se recupera la cuenta.
     *
     * Añadirlo NO abre un secuestro de cuenta: el contacto nuevo nace `unverified` y no sustituye al
     * primario hasta que se verifica con su código. Lo que se permite aquí es DECLARAR un contacto,
     * no autenticarse con él.
     *
     * Los estados que siguen bloqueados son los que bloquean todo —`blocked`, `rejected`, `closed`—,
     * donde el problema no es el dato de contacto.
     */
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status) && status !== 'active') {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const contactValueHash = hashSensitiveText(input.body.value);
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.profileDataRepository.findContactMethodByHash(input.tenantId, input.customerId, contactValueHash, {
        transaction,
      });
      if (existing) {
        /*
         * El mismo valor, del mismo cliente, sin verificar: es una corrección que quedó a medias
         * —la app se cerró entre «agregar» y «confirmar el código»—, no un duplicado. Responder 409
         * aquí dejaba a la persona sin salida: sin el id no puede pedir el código sobre el contacto
         * nuevo, y pedirlo sin id elige el principal sin verificar, que es justo el mal escrito.
         * Se devuelve el existente para que retome; no se crea fila ni se audita otra alta.
         */
        if (existing.status !== 'verified') {
          const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);
          return {
            customerId: input.customerId,
            contactMethodId: String(existing.id),
            contactType: existing.contactType,
            status: existing.status,
            valueLast4: existing.valueLast4,
            emailDomain: existing.emailDomain,
            nextStep: assessment.nextStep,
          };
        }
        // Ya lo tiene verificado: no es «está en otra cuenta», que es lo que la app dice ante
        // `CONTACT_ALREADY_REGISTERED`. Son dos instrucciones distintas para la persona.
        throw new ConflictException('CONTACT_ALREADY_VERIFIED');
      }

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

      // `nextStep` del evaluador, igual que el resto de los pasos: un solo cálculo server-side.
      const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);

      return {
        customerId: input.customerId,
        contactMethodId: String(contact.id),
        contactType: contact.contactType,
        status: contact.status,
        valueLast4: contact.valueLast4,
        emailDomain: contact.emailDomain,
        // El id devuelto es el que hay que mandar en `contactMethodId` al pedir el código: así el
        // OTP viaja al contacto recién agregado y no al que el cliente está corrigiendo.
        nextStep: assessment.nextStep,
      };
    });
  }
}
