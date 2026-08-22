/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { CustomerContactMethodModel, CustomerModel } from '../../../database/models/index.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerContactsRepository } from '../../customers/repositories/customer-contacts.repository.js';
import { CustomerContactVerificationRepository } from '../repositories/customer-contact-verification.repository.js';

export type ContactType = 'phone' | 'email';

/**
 * Qué contacto se verifica, y qué pasa con el principal cuando la verificación sale bien.
 *
 * Vive aparte de `CustomerContactVerificationService` porque resuelve una pregunta distinta —"¿sobre
 * cuál de los contactos del cliente estamos operando?"— y porque es la mitad del arreglo del
 * callejón sin salida de la corrección de contacto: elegir el correcto (aquí) y dejarlo como
 * principal al verificarlo (también aquí). El servicio de verificación se queda con el ciclo del
 * código y su bitácora.
 */
@Injectable()
export class ContactMethodResolutionService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
    // Directo al repositorio especializado: elegir el contacto y promoverlo a principal son dos
    // consultas de contacto, y la fachada de onboarding no gana nada reenviándolas.
    private readonly contactVerificationRepository: CustomerContactVerificationRepository,
  ) {}

  /**
   * Contacto sobre el que operar.
   *
   * Con `contactMethodId` explícito manda el cliente (es como corrige un dato mal escrito); sin él,
   * el repositorio devuelve el que todavía falta verificar de ese tipo. Antes no existía la opción
   * explícita y la búsqueda siempre devolvía el primario, de modo que un teléfono corregido nunca
   * llegaba a recibir el código.
   */
  async resolve(input: {
    tenantId: string;
    customerId: string;
    contactType: ContactType;
    contactMethodId?: string;
    transaction: Transaction;
  }): Promise<CustomerContactMethodModel> {
    const contactMethod = input.contactMethodId
      ? await this.contactVerificationRepository.findCustomerContactMethodById(
          input.tenantId,
          input.customerId,
          input.contactType,
          input.contactMethodId,
          { transaction: input.transaction },
        )
      : await this.contactVerificationRepository.findCustomerContactMethod(input.tenantId, input.customerId, input.contactType, {
          transaction: input.transaction,
        });

    if (!contactMethod) throw new UnprocessableEntityException('CONTACT_NOT_REGISTERED');
    return contactMethod;
  }

  /**
   * Deja como principal el contacto recién verificado y sincroniza las columnas del cliente.
   *
   * No hace nada si ya era el principal — el caso normal del registro. Se comprueba antes que el
   * valor no pertenezca ya a otro cliente del tenant: los índices únicos parciales de `customers`
   * lo rechazarían de todos modos, pero como error de driver a mitad de la transacción en vez de
   * como el conflicto de negocio que es.
   */
  async promoteToPrimary(input: {
    tenantId: string;
    customer: CustomerModel;
    contactMethod: CustomerContactMethodModel;
    now: Date;
    transaction: Transaction;
  }): Promise<{ promoted: boolean }> {
    if (input.contactMethod.isPrimary) return { promoted: false };

    // Sin huella no hay nada que sincronizar en `customers`, y promover a ciegas dejaría la columna
    // principal apuntando a un valor que ninguna consulta puede resolver. Se deja como estaba.
    const contactValueHash = input.contactMethod.contactValueHash;
    if (!contactValueHash) return { promoted: false };

    const contactType = input.contactMethod.contactType === 'phone' ? 'phone' : 'email';
    const owner = await this.customersRepository.findByContactHash(input.tenantId, {
      phoneHash: contactType === 'phone' ? contactValueHash : undefined,
      emailHash: contactType === 'email' ? contactValueHash : undefined,
    });
    if (owner && String(owner.id) !== String(input.customer.id)) {
      throw new ConflictException('CONTACT_ALREADY_REGISTERED');
    }

    await this.contactVerificationRepository.promoteContactMethodToPrimary(input.contactMethod, input.now, {
      transaction: input.transaction,
    });
    await this.customerContactsRepository.updatePrimaryContact(
      input.customer,
      {
        contactType,
        contactValueHash,
        valueLast4: input.contactMethod.valueLast4,
        emailDomain: input.contactMethod.emailDomain,
      },
      input.now,
      { transaction: input.transaction },
    );

    return { promoted: true };
  }
}
